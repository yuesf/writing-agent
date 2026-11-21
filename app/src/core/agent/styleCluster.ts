// 对标库 → 写作风格自动划分（ADR-019）
//
// 为什么是「增量归属」而不是「一次性聚类」：
//   1) 一次性聚类每次新增文章都要重跑，风格 id 会漂移，历史写作引用失效；
//   2) 全库摘录塞进一个 prompt 会超上下文，且首篇的超长摘录容易主导分簇结果；
//   3) 增量式与产品定位一致——库越大分得越准，风格档案可以一直复用。
// 代价：首轮可能把同一风格拆成两个（LLM 归属判断有抖动），靠「能归入就归入」的提示词约束压住。
//
// 归属结果落两处：asset(type='style') 存风格档案（写作时注入用），
// benchmark.style_id/style_name 记归属（列表展示、篇数统计用，不额外维护计数）。
// 纯格式化逻辑在 styleProfile.ts，这里只做编排与存储。

import { addAsset, listAssets, listBenchmarks, setBenchmarkStyle, updateAsset } from '../db'
import type { Asset, Benchmark } from '../types'
import { chatOnce, parseJsonLoose } from './llm'
import type { LlmEndpoint } from './llm'
import { normalizeProfile, profileText, rubricTotal, styleNameOf, styleTags } from './styleProfile'
import type { StyleProfile } from './styleProfile'

export type { StyleProfile } from './styleProfile'
export { profileText, styleNameOf, rubricTotal } from './styleProfile'

export interface ClusterProgress {
  index: number
  total: number
  title: string
}

export interface ClusterResult {
  total: number // 本次待划分篇数
  created: number // 新建风格数
  joined: number // 归入已有风格数
  failed: number
  samples: number // 库里有摘录、可参与划分的篇数
}

// 档案太多时 prompt 会变长、判断也会变糊；按篇数取前 N 个足够区分主流写法
const MAX_STYLES_IN_PROMPT = 8
const MIN_EXCERPT = 100

function styleListText(styles: Asset[]): string {
  if (!styles.length) return '（暂无已有风格档案，这篇将成为第一个风格）'
  return styles
    .slice(0, MAX_STYLES_IN_PROMPT)
    .map(x => `- id=${x.id}｜${styleNameOf(x)}｜${x.content.split('\n')[1]?.replace(/^一句话：/, '') ?? ''}`)
    .join('\n')
}

export async function analyzeBenchmarkStyle(
  cfg: LlmEndpoint,
  b: Benchmark,
  styles: Asset[]
): Promise<StyleProfile> {
  const out = await chatOnce(
    cfg,
    [
      {
        role: 'system',
        content:
          '你是写作风格分析器。你的任务是把一篇对标文章归纳成可复用的写法特征（不是内容摘要）。只输出 JSON，不要任何解释文字。'
      },
      {
        role: 'user',
        content: [
          '【已有风格档案】（能归入就归入；只有文体、语气、结构骨架、句式节奏明显不同族时才新建）',
          styleListText(styles),
          '',
          '【本次文章】',
          `标题：${b.title || '(无标题)'}`,
          `原文标签：${b.tags || '无'}`,
          '摘录：',
          (b.excerpt ?? '').slice(0, 900),
          '',
          '判断口径：主题不同、篇幅不同不算不同风格；文体/语气/结构骨架/开头方式/句式节奏这几项同族就算同一风格。',
          '输出 JSON（match_id 命中已有档案时填其 id，否则 null）：',
          '{"match_id":null,"style_name":"不超过8字","summary":"一句话说清这种写法怎么组织语言","文体":"","语气":"","结构":"","开头钩子":"","人称":"","句式":"","术语密度":"","段落节奏":"","tags":["不超过6个特征词"],"reason":"归属或新建的依据"}'
        ].join('\n')
      }
    ],
    { temperature: 0.2 }
  )

  const parsed = parseJsonLoose<Partial<StyleProfile>>(out)
  if (!parsed) throw new Error('模型没有返回可解析的 JSON')
  return normalizeProfile(parsed, styles)
}

// 新样本加入已有档案时只合并特征标签，不改写档案正文：
// 每篇都重写一次描述会让档案随最后几篇漂移，反而丢掉了「这个风格是什么」的稳定定义。
async function mergeTags(asset: Asset, tags: string[]): Promise<void> {
  if (!tags.length) return
  const merged = [...new Set([...(asset.tags ?? '').split(','), ...tags].filter(Boolean))]
  await updateAsset(asset.id, { tags: merged.slice(0, 12).join(',') })
}

// 质量分 = 该风格下文章的平均 Rubric 总分，写作时择优排序用（无分的按 0）。
// 它依赖「文章 × Rubric」两样东西，所以打分、删文章、撤销入库之后都会过期。
// 划分结束时调一次不够：全部归类后 pendingCount 归零、划分按钮禁用，用户没别的办法纠正，
// 所以页面 reload 时也收敛一次（见 Benchmark.vue），保证择优用的分不会一直陈旧。
export async function syncStyleQuality(): Promise<boolean> {
  const bms = await listBenchmarks()
  const styles = await listAssets({ type: 'style', source: 'benchmark' })
  let changed = false
  for (const st of styles) {
    const group = bms.filter(b => b.style_id === st.id)
    const scored = group.map(b => rubricTotal(b.rubric)).filter(n => n > 0)
    const q = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : 0
    if (Math.abs((st.quality ?? 0) - q) > 0.01) {
      await updateAsset(st.id, { quality: q })
      changed = true
    }
  }
  return changed
}

export async function clusterBenchmarkStyles(
  cfg: LlmEndpoint,
  onProgress?: (p: ClusterProgress) => void
): Promise<ClusterResult> {
  const all = await listBenchmarks()
  const pool = all.filter(b => (b.excerpt ?? '').trim().length >= MIN_EXCERPT)
  const targets = pool.filter(b => !b.style_id)

  let created = 0
  let joined = 0
  let failed = 0

  for (let i = 0; i < targets.length; i++) {
    const b = targets[i]
    onProgress?.({ index: i + 1, total: targets.length, title: b.title })
    try {
      // 每篇都重新读一遍档案：前一篇可能刚新建了一个风格，后面的要能归进去
      const styles = await listAssets({ type: 'style', source: 'benchmark' })
      const a = await analyzeBenchmarkStyle(cfg, b, styles)
      const hit = a.match_id ? styles.find(x => x.id === a.match_id) : null
      if (hit) {
        const name = styleNameOf(hit)
        await setBenchmarkStyle(b.id, hit.id, name)
        await mergeTags(hit, a.tags)
        joined++
      } else {
        const id = await addAsset({
          type: 'style',
          source: 'benchmark',
          content: profileText(a),
          tags: styleTags(a),
          quality: 0,
          sensitive: 0
        })
        await setBenchmarkStyle(b.id, id, a.style_name)
        created++
      }
    } catch {
      // 单篇失败不影响其他篇：留着未划分状态，下次点一次重跑即可
      failed++
    }
  }

  if (created || joined) await syncStyleQuality()

  return { total: targets.length, created, joined, failed, samples: pool.length }
}

// 解绑某篇（风格档案删了以后用），避免 benchmark 指向不存在的 id
export async function detachBenchmarkStyles(styleId: number): Promise<void> {
  const bms = await listBenchmarks()
  for (const b of bms.filter(x => x.style_id === styleId)) {
    await setBenchmarkStyle(b.id, 0, '')
  }
}
