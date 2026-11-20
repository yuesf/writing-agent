// 风格档案的纯数据处理：构造、归一化、渲染成提示词文本。
// 刻意不依赖 db / llm —— 这一层可以在 node 里直接单测，不需要 mock 存储。
import type { Asset } from '../types'

export interface StyleProfile {
  match_id: number | null // 命中的已有档案 id；null = 新建
  style_name: string
  summary: string
  genre: string // 文体
  tone: string // 语气
  structure: string // 结构骨架
  opener: string // 开头方式
  person: string // 人称
  syntax: string // 句式
  jargon: string // 术语密度
  rhythm: string // 段落节奏
  tags: string[]
  reason: string
}

export const MAX_TAGS = 12

function s(v: any, max = 40): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

// 模型输出不可全信：字段类型、超长、编造不存在的 match_id 都要在这里收口
export function normalizeProfile(p: Partial<StyleProfile> | null, styles: Asset[]): StyleProfile {
  const src = p ?? {}
  const matched = Number(src.match_id)
  const hit = styles.find(x => x.id === matched)
  const tags = Array.isArray(src.tags)
    ? src.tags.map(t => s(t, 8)).filter(Boolean).slice(0, 6)
    : []
  return {
    match_id: hit ? hit.id : null,
    style_name: s(src.style_name, 12) || '未命名风格',
    summary: s(src.summary, 80),
    genre: s(src.genre, 20),
    tone: s(src.tone, 20),
    structure: s(src.structure, 40),
    opener: s(src.opener, 20),
    person: s(src.person, 12),
    syntax: s(src.syntax, 30),
    jargon: s(src.jargon, 12),
    rhythm: s(src.rhythm, 20),
    tags,
    reason: s(src.reason, 100)
  }
}

// 风格档案给模型看的文本：短、结构化，直接进六层提示词的资产层
export function profileText(p: StyleProfile): string {
  const lines = [
    `【${p.style_name}】`,
    p.summary ? `一句话：${p.summary}` : '',
    `文体：${p.genre || '未定'}｜语气：${p.tone || '未定'}｜结构：${p.structure || '未定'}`,
    `开头：${p.opener || '未定'}｜人称：${p.person || '未定'}｜句式：${p.syntax || '未定'}`,
    `术语密度：${p.jargon || '未定'}｜段落节奏：${p.rhythm || '未定'}`
  ]
  return lines.filter(Boolean).join('\n')
}

export function styleNameOf(asset: Asset): string {
  const m = (asset.content ?? '').match(/^【(.+?)】/)
  return m ? m[1] : (asset.tags ?? '').split(',')[1] || '未命名风格'
}

export function styleTags(p: StyleProfile): string {
  const base = ['风格', p.style_name, p.genre, p.tone, ...p.tags].filter(Boolean)
  return [...new Set(base)].slice(0, MAX_TAGS).join(',')
}

// Rubric JSON 里取总分；取不到按 0（质量分只用于择优排序，不影响归档）
export function rubricTotal(rubric: string): number {
  if (!rubric) return 0
  try {
    const j = JSON.parse(rubric)
    const t = Number(j?.['总分'])
    if (Number.isFinite(t) && t > 0) return t
  } catch {
    // 老数据可能不是合法 JSON，走下面的正则兜底
  }
  const m = rubric.match(/"总分"\s*:\s*(\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : 0
}
