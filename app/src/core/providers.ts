// 服务商预设（ADR-016）
// 用户只选服务商，接口地址由预设带出；模型优先从各家的 /models 接口实时拉取，
// 静态列表仅作兜底（部分厂商不提供该端点，或用户还没填 Key）。
import { describeHttpError, requestJson } from './http'

export interface ProviderPreset {
  id: string
  label: string
  base_url: string // OpenAI 兼容端点，选定服务商即自动带出
  models: string[] // 静态兜底
  note?: string
}

// 只保留 DeepSeek / MiniMax 两家。此处仅作旧配置的兜底标记，
// 不再出现在服务商下拉里；老配置命中时会退化成可手填地址的自定义模式。
export const CUSTOM_PROVIDER_ID = 'custom'

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    base_url: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner']
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    base_url: 'https://api.minimaxi.com/v1',
    models: [
      'MiniMax-M2.7', 'MiniMax-M2.7-highspeed',
      'MiniMax-M2.5', 'MiniMax-M2.5-highspeed',
      'MiniMax-M2.1', 'MiniMax-M2'
    ],
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
export interface ModelListResult {
  models: string[]
  source: 'api' | 'preset'
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

export async function loadModels(
  baseUrl: string,
  apiKey: string,
  fallback: string[] = []
): Promise<ModelListResult> {
  const base = (baseUrl ?? '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('请先选择服务商或填写接口地址')

  const res = await requestJson({
    url: `${base}/models`,
    headers: { Authorization: `Bearer ${apiKey.trim()}`, Accept: 'application/json' },
    readTimeoutMs: 30000
  })

  if (!res.ok) {
    // 有一部分厂商没有 /models 端点，此时退回静态列表，不把功能卡死
    if (fallback.length && (res.status === 404 || res.status === 405)) {
      return { models: fallback, source: 'preset', note: '该服务商不提供模型列表接口，已使用内置常用模型，可手动核对。' }
    }
    throw new Error(describeHttpError(res.status, res.text))
  }

  const all = extractIds(res.data)
  if (!all.length) {
    if (fallback.length) {
      return { models: fallback, source: 'preset', note: '接口没有返回可识别的模型，已使用内置常用模型。' }
    }
    throw new Error('接口返回里没有找到模型列表')
  }

  const chat = all.filter(isChatModel)
  const models = chat.length ? chat : all
  return {
    models,
    source: 'api',
    note: `已从服务商拉取 ${models.length} 个对话模型${chat.length && chat.length < all.length ? `（已过滤 ${all.length - chat.length} 个非对话模型）` : ''}。`
  }
}

export function modelHintOf(preset?: ProviderPreset): string {
  if (!preset) return ''
  if (preset.note) return preset.note
  return ''
}
