// 统一 HTTP 层（ADR-016）
// 问题：真机上 WebView 的 origin 是 https://localhost，直连第三方 API 会被 CORS 拦；
//      而 LLM 服务商不会为我们开 Access-Control-Allow-Origin。
// 方案：真机走 CapacitorHttp 原生栈（不受浏览器同源策略约束），浏览器开发态走 fetch。
// 代价：原生栈拿的是完整响应，没有 SSE 流式——流式只在浏览器生效，真机降级为一次性返回。
import { Capacitor, CapacitorHttp } from '@capacitor/core'

export interface HttpResult {
  status: number
  ok: boolean
  data: any // 已尽力解析为对象；解析失败保留原始文本
  text: string
}

export interface HttpRequest {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: any // 对象会被 JSON 序列化
  connectTimeoutMs?: number
  readTimeoutMs?: number
}

export function isNative(): boolean {
  return Capacitor.isNativePlatform()
}

function normalize(status: number, data: any): HttpResult {
  const ok = status >= 200 && status < 300
  if (data && typeof data === 'object') {
    return { status, ok, data, text: JSON.stringify(data) }
  }
  const text = typeof data === 'string' ? data : data == null ? '' : String(data)
  let parsed: any = text
  if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try {
      parsed = JSON.parse(text)
    } catch {
      // 保留原文，由调用方按文本处理
    }
  }
  return { status, ok, data: parsed, text }
}

export async function requestJson(req: HttpRequest): Promise<HttpResult> {
  const method = req.method ?? 'GET'
  const headers: Record<string, string> = { ...(req.headers ?? {}) }

  if (isNative()) {
    if (req.body !== undefined) headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'
    const res = await CapacitorHttp.request({
      url: req.url,
      method,
      headers,
      data: req.body,
      responseType: 'text',
      connectTimeout: req.connectTimeoutMs ?? 20000,
      readTimeout: req.readTimeoutMs ?? 180000
    })
    return normalize(res.status, res.data)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), req.readTimeoutMs ?? 180000)
  try {
    const res = await fetch(req.url, {
      method,
      headers: req.body !== undefined ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: controller.signal
    })
    const text = await res.text()
    return normalize(res.status, text)
  } finally {
    clearTimeout(timer)
  }
}

// 把服务端错误体压成一句人话，避免把整段 HTML 错误页甩给用户
export function describeHttpError(status: number, text: string): string {
  const body = (text ?? '').slice(0, 400)
  let detail = body
  if (body.trim().startsWith('{')) {
    try {
      const j = JSON.parse(body)
      detail = j?.error?.message ?? j?.message ?? j?.base_resp?.status_msg ?? body
    } catch {
      // 保持原文
    }
  }
  const hint =
    status === 401 || status === 403
      ? 'API Key 无效或没有该模型的权限'
      : status === 404
        ? '接口地址不对，或该服务商不提供此端点'
        : status === 429
          ? '触发限流或余额不足'
          : status >= 500
            ? '服务商侧故障，稍后重试'
            : ''
  return `HTTP ${status}${hint ? `（${hint}）` : ''}：${detail}`
}
