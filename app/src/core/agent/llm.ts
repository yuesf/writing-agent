// OpenAI 兼容客户端（ADR-003：借鉴 Vercel AI SDK 的流式封装思路，自研轻量）
// 全部请求走 core/http 统一层：真机用原生栈（绕开 WebView 跨域），浏览器用 fetch。
import { describeHttpError, isNative, requestJson } from '../http'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmEndpoint {
  base_url: string
  model: string
  api_key: string
}

function endpointOf(config: LlmEndpoint): string {
  return `${config.base_url.trim().replace(/\/+$/, '')}/chat/completions`
}

function authHeaders(config: LlmEndpoint): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.api_key.trim()}`
  }
}

export async function chatStream(
  config: LlmEndpoint,
  messages: ChatMessage[],
  onDelta?: (text: string) => void
): Promise<string> {
  // 真机：原生 HTTP 不支持 SSE，降级为一次性返回（拿到全文后一次推给 UI）
  if (isNative()) {
    const full = await chatOnce(config, messages, { temperature: 0.7 })
    onDelta?.(full)
    return full
  }

  const res = await fetch(endpointOf(config), {
    method: 'POST',
    headers: authHeaders(config),
    body: JSON.stringify({ model: config.model, messages, stream: true })
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(describeHttpError(res.status, err))
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      const data = t.slice(5).trim()
      if (data === '[DONE]') return full
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content
        if (delta) {
          full += delta
          onDelta?.(delta)
        }
      } catch {
        // 忽略不完整分片
      }
    }
  }
  return full
}

// 非流式一次性调用：结构化输出场景（档案提炼、Rubric 打分），也是真机上的默认通道
export async function chatOnce(
  config: LlmEndpoint,
  messages: ChatMessage[],
  opts?: { temperature?: number }
): Promise<string> {
  const body: Record<string, any> = {
    model: config.model,
    messages,
    stream: false,
    temperature: opts?.temperature ?? 0.2
  }
  const res = await requestJson({
    url: endpointOf(config),
    method: 'POST',
    headers: authHeaders(config),
    body,
    readTimeoutMs: 180000
  })
  if (!res.ok) throw new Error(describeHttpError(res.status, res.text))
  return res.data?.choices?.[0]?.message?.content ?? ''
}

// 从模型输出里抠出 JSON（容忍 ```json 包裹与前后废话）
export function parseJsonLoose<T>(text: string): T | null {
  const start = Math.min(...['[', '{'].map(c => { const i = text.indexOf(c); return i < 0 ? Infinity : i }))
  if (!isFinite(start)) return null
  const open = text[start]
  const close = open === '[' ? ']' : '}'
  const end = text.lastIndexOf(close)
  if (end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as T
  } catch {
    return null
  }
}
