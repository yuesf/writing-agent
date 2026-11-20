// 公众号链接抓取（ADR-017 修订 ADR-007）
//
// 允许：用户主动粘贴链接 → 单篇抓取 → 预填表单 → 用户确认后才入库
// 禁止：批量爬取、后台自动同步、跨用户共享抓取结果、全文落库
//
// 实测（2026-11-20）：
//   公众号文章 200，正文容器 #js_content 可取；知乎 403（需登录 cookie），故只做公众号。
// 限制：只在真机可用——浏览器 origin 是 https://localhost，公众号不返回 CORS 头，fetch 会被拦；
//      真机走 CapacitorHttp 原生栈，不受同源策略约束。

import { isNative, requestJson } from './http'

export interface FetchedArticle {
  url: string
  title: string
  author: string
  publishedAt: string // YYYY-MM-DD，取不到为空串
  body: string // 全文，仅内存用于打分/风格分析，绝不落库
  excerpt: string // 自动抽取的代表段落，这才是入库内容
  chars: number
}

const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'

// 公众号风控/失效页面的特征串。命中即明确报错，绝不静默入一个空壳。
const BLOCKERS: Array<[string, string]> = [
  ['环境异常', '公众号风控拦截了这次访问（页面提示"环境异常"）。等几分钟再试，或在微信里打开后复制正文粘贴。'],
  ['完成验证后即可继续访问', '公众号要求完成人机验证，本次抓取被拦。请在微信里打开文章，复制正文粘贴。'],
  ['请在微信客户端打开链接', '这个链接被限制为仅微信内打开。请在微信里复制正文后粘贴。'],
  ['该内容已被发布者删除', '这篇文章已被作者删除，做不了对标样本。'],
  ['此内容因违规无法查看', '这篇文章已被平台下架，做不了对标样本。']
]

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

// 用户可能整段粘贴（含文字、参数被转义的链接），这里只抠出公众号链接
export function pickWechatUrl(input: string): string | null {
  const text = (input ?? '').trim()
  if (!text) return null
  const m = text.match(/https?:\/\/mp\.weixin\.qq\.com\/[^\s"'<>）)，。]+/i)
  return m ? decodeEntities(m[0]) : null
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function cleanText(raw: string): string {
  return raw
    .replace(/\u00a0/g, ' ')
    .replace(/\u200b/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(l => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// 按块级元素切段，避免 textContent 把所有段落粘成一行
function blockText(root: Element): string {
  const out: string[] = []
  const BLOCK = new Set(['p', 'section', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'tr'])

  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      out.push(node.textContent ?? '')
      return
    }
    if (node.nodeType !== 1) return
    const el = node as Element
    const tag = el.tagName.toLowerCase()
    if (tag === 'script' || tag === 'style' || tag === 'svg') return
    if (tag === 'br') {
      out.push('\n')
      return
    }
    if (tag === 'img') return
    const isBlock = BLOCK.has(tag)
    if (isBlock) out.push('\n')
    for (const child of Array.from(el.childNodes)) walk(child)
    if (isBlock) out.push('\n')
  }

  walk(root)
  return cleanText(out.join(''))
}

function firstText(doc: Document, selectors: string[]): string {
  for (const sel of selectors) {
    const el = doc.querySelector(sel)
    const t = el?.textContent?.trim()
    if (t) return t
  }
  return ''
}

// 页面内联脚本里的 var xxx = "..." / '...' / htmlDecode("...")
function metaString(html: string, name: string): string {
  const re = new RegExp(`var\\s+${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|htmlDecode\\("([^"]*)"\\))`)
  const m = html.match(re)
  const v = m ? (m[1] ?? m[2] ?? m[3] ?? '') : ''
  return decodeEntities(v).trim()
}

function publishDate(html: string, doc: Document): string {
  const shown = firstText(doc, ['#publish_time'])
  const m = shown.match(/(\d{4})[-年/.](\d{1,2})[-月/.](\d{1,2})/)
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`

  const raw = metaString(html, 'ct') || metaString(html, 'create_time')
  const sec = Number(raw)
  if (Number.isFinite(sec) && sec > 1_000_000_000) {
    const d = new Date(sec * 1000)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  return ''
}

function clipAtSentence(text: string, max: number): string {
  if (text.length <= max) return text
  const slice = text.slice(0, max)
  const cut = Math.max(
    slice.lastIndexOf('。'),
    slice.lastIndexOf('！'),
    slice.lastIndexOf('？'),
    slice.lastIndexOf('\n')
  )
  return cut > max * 0.5 ? slice.slice(0, cut + 1).trim() : slice.trim()
}

// 公众号正文末尾常带一段推广尾注（关注引导、二维码、商务联系），
// 留着会污染风格分析与 Rubric（"可读性/风格一致性"会被尾注拉偏），按行首特征切掉。
const FOOTER_MARKERS: RegExp[] = [
  /^预览时标签不可点/,
  /^扫二维码/,
  /^扫描二维码/,
  /^长按识别二维码/,
  /^长按二维码/,
  /^我知道你在看/,
  /^点个?在?看/,
  /^点赞.*在看/,
  /^商务合作请联系/,
  /^点击上方.*关注/,
  /^关注我们.*获取更多/,
  /^温馨提示$/,
  /^免责声明/,
  /^版权声明/,
  /^版权归.*所有/,
  /^声明[:：]/,
  /^本文仅代表作者/,
  /^转载.*请联系/
]

function stripFooter(body: string): string {
  const lines = body.split('\n')
  // 只在正文后 40% 范围内认尾注——"温馨提示"这类词也可能出现在正文中段，
  // 全局匹配会把正文从中间切掉，这是不可接受的误伤。
  const from = Math.floor(lines.length * 0.6)
  let cut = -1
  for (let i = from; i < lines.length; i++) {
    if (FOOTER_MARKERS.some(re => re.test(lines[i].trim()))) { cut = i; break }
  }
  let kept = cut >= 0 ? lines.slice(0, cut) : lines

  // 尾注前面常有一行公众号名，一起清掉（纯短行、无标点，最多 3 行）
  for (let i = 0; i < 3 && kept.length; i++) {
    const last = kept[kept.length - 1].trim()
    if (last && last.length <= 12 && !/[，。！？；：、"'）)]/.test(last)) kept = kept.slice(0, -1)
    else break
  }

  return cleanText(kept.join('\n'))
}

// 只存摘录：开头 + 结尾各取一段，够 LLM 判风格与钩子，不构成全文转载
function buildExcerpt(body: string): string {
  const head = clipAtSentence(body, 500)
  if (body.length <= 800) return head
  const tail = body.slice(Math.max(0, body.length - 250)).trim()
  return `${head}\n……\n${tail}`
}

export function parseWechatHtml(html: string, url: string): FetchedArticle {
  if (!html || html.length < 500) {
    throw new Error('页面返回内容异常（内容过短），可能是链接失效。请稍后重试或手动粘贴正文。')
  }

  for (const [marker, reason] of BLOCKERS) {
    if (html.includes(marker)) throw new Error(reason)
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const contentEl = doc.querySelector('#js_content')
  if (!contentEl) {
    throw new Error('没找到正文容器（公众号可能改版，或这不是一篇图文文章）。请手动粘贴正文。')
  }

  const body = stripFooter(blockText(contentEl))
  if (body.length < 120) {
    throw new Error('正文提取不到文字（可能是纯图片长图文章）。这类文章做不了风格样本，请换一篇。')
  }

  return {
    url,
    title: firstText(doc, ['#activity-name', '.rich_media_title']) || metaString(html, 'msg_title'),
    author: firstText(doc, ['#js_name', '.rich_media_meta_nickname']) || metaString(html, 'nickname'),
    publishedAt: publishDate(html, doc),
    body,
    excerpt: buildExcerpt(body),
    chars: body.length
  }
}

export async function fetchWechatArticle(link: string): Promise<FetchedArticle> {
  const url = pickWechatUrl(link)
  if (!url) {
    throw new Error('只识别公众号文章链接（https://mp.weixin.qq.com/s/...）。其他平台请手动粘贴正文。')
  }
  if (!isNative()) {
    throw new Error('链接抓取只在手机 App 内可用：浏览器调试受同源策略限制。调试时请直接粘贴正文。')
  }

  const res = await requestJson({
    url,
    headers: {
      'User-Agent': MOBILE_UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    },
    connectTimeoutMs: 15000,
    readTimeoutMs: 45000
  })

  if (!res.ok) {
    throw new Error(
      `打开链接失败（HTTP ${res.status}）${res.status === 404 ? '：文章可能已被删除' : res.status === 403 ? '：访问被拒绝，可能需要在微信内打开' : ''}。请手动粘贴正文。`
    )
  }

  const html = typeof res.data === 'string' ? res.data : res.text
  return parseWechatHtml(html, url)
}
