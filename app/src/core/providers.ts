// 服务商预设（ADR-016）
// 用户只选服务商，接口地址由预设带出；模型一律从各家的 /models 接口实时拉取，
// 不在客户端内置任何模型清单——内置清单会随厂商上下架而过期，反而误导用户。
import { describeHttpError, requestJson } from './http'

export interface ProviderPreset {
  id: string
  label: string
  base_url: string // OpenAI 兼容端点，选定服务商即自动带出
  note?: string
}

// 只保留 DeepSeek / MiniMax 两家。此处仅作旧配置的兜底标记，
// 不再出现在服务商下拉里；老配置命中时会退化成可手填地址的自定义模式。
export const CUSTOM_PROVIDER_ID = 'custom'

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    base_url: 'https://api.deepseek.com/v1'
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    base_url: 'https://api.minimaxi.com/v1',
    note: '国内站（platform.minimaxi.com）的 Key 配 api.minimaxi.com；国际站（platform.minimax.io）的 Key 要改成 api.minimax.io，混用会鉴权失败。'
  }
]

export function providerById(id: string): ProviderPreset | undefined {
  return PROVIDERS.find(p => p.id === id)
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return ''
  }
}

// 旧配置没有 provider 字段时，用接口地址反查服务商
export function providerByUrl(url: string): ProviderPreset | undefined {
  const host = hostOf(url ?? '')
  if (!host) return undefined
  return PROVIDERS.find(p => p.id !== CUSTOM_PROVIDER_ID && hostOf(p.base_url) === host)
}

// ---------- 模型列表拉取 ----------
// 只有一条通路：GET {base_url}/models。不内置任何清单兜底，
// 拉不到就让用户看到真实原因（或手动填写），不要用过期型号糊住问题。
export interface ModelListResult {
  models: string[]
  note: string
}

// 写作场景用不到这些能力，拉回来堆在下拉里只会干扰选择
const NON_CHAT = [
  'embedding', 'embed-', 'rerank', 'tts', 'whisper', 'speech', 'audio',
  'moderation', 'dall-e', 'stable-diffusion', 'flux', 'ocr', 'image', 'video', 'sora'
]

function isChatModel(id: string): boolean {
  const low = id.toLowerCase()
  return !NON_CHAT.some(k => low.includes(k))
}

function extractIds(payload: any): string[] {
  const arr: any[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : Array.isArray(payload?.result)
          ? payload.result
          : []
  const ids = arr
    .map(x => (typeof x === 'string' ? x : (x?.id ?? x?.model ?? x?.name ?? '')))
    .map((x: any) => String(x).trim())
    .filter(Boolean)
  return [...new Set(ids)] as string[]
}

export async function loadModels(baseUrl: string, apiKey: string): Promise<ModelListResult> {
  const base = (baseUrl ?? '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('请先选择服务商或填写接口地址')

  const res = await requestJson({
    url: `${base}/models`,
    headers: { Authorization: `Bearer ${apiKey.trim()}`, Accept: 'application/json' },
    readTimeoutMs: 30000
  })

  if (!res.ok) {
    if (res.status === 404 || res.status === 405) {
      throw new Error('该地址没有提供模型列表接口（HTTP ' + res.status + '）：请换个地址，或点「手动填写模型名」直接填。')
    }
    throw new Error(describeHttpError(res.status, res.text))
  }

  const all = extractIds(res.data)
  if (!all.length) throw new Error('接口返回里没有找到模型列表，可点「手动填写模型名」直接填。')

  const chat = all.filter(isChatModel)
  const models = chat.length ? chat : all
  return {
    models,
    note: `已从服务商拉取 ${models.length} 个对话模型${chat.length && chat.length < all.length ? `（已过滤 ${all.length - chat.length} 个非对话模型）` : ''}。`
  }
}
