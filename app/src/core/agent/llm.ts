// OpenAI 兼容流式客户端（ADR-003：借鉴 Vercel AI SDK 的流式封装思路，自研轻量）
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function chatStream(
  config: { base_url: string; model: string; api_key: string },
  messages: ChatMessage[],
  onDelta?: (text: string) => void
): Promise<string> {
  const res = await fetch(`${config.base_url.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.api_key}` },
    body: JSON.stringify({ model: config.model, messages, stream: true })
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`LLM 请求失败 ${res.status}: ${err.slice(0, 300)}`)
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
