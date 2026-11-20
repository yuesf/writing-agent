// 档案演化引擎（ADR-015）：从真实交互信号里提炼"作者是谁"的候选事实
// 关键取舍：只提炼、不直接改档案 —— 候选入待确认表，人工采纳后才合并
import type { ProfileField } from '../types'
import { PROFILE_FIELDS } from '../types'
import { addProposal, getLlmConfig, getProfile, getProject, getStages, listEvents } from '../db'
import { chatOnce, parseJsonLoose } from './llm'

interface RawProposal {
  field?: string
  value?: string
  reason?: string
  confidence?: number
}

const FIELD_HINT = `name=称呼 / profession=职业领域 / background=身份背景与经历 / platform=写作平台与账号定位 / audience=目标读者`

function fieldLabel(f: ProfileField): string {
  return FIELD_HINT.split(' / ').find(s => s.startsWith(f))?.split('=')[1] ?? f
}

// 收集"高信号"交互：调整指令 + 项目要求（用户亲口下的约束），不拿 AI 产物当作者画像
async function collectSignals(projectId: number): Promise<string> {
  const project = await getProject(projectId)
  const events = await listEvents(projectId)
  const directives = events.filter(e => e.event === 'directive_added').map(e => {
    try {
      return String(JSON.parse(e.payload || '{}').directive ?? '')
    } catch {
      return ''
    }
  }).filter(Boolean)

  const stages = await getStages(projectId)
  const confirmed = stages.filter(s => s.status === 'confirmed').map(s => s.stage)

  const parts: string[] = []
  if (project) {
    parts.push(`选题：${project.title} —— ${project.topic_brief}`)
    if (project.requirements.trim()) parts.push(`本次写作要求：${project.requirements.trim()}`)
  }
  if (directives.length) parts.push('用户对生成结果下达的调整指令（去重）：\n' + [...new Set(directives)].map(d => `- ${d}`).join('\n'))
  if (confirmed.length) parts.push(`已确认阶段：${confirmed.join(' / ')}`)
  return parts.join('\n\n')
}

const SYSTEM = `你是"作者画像提炼器"。任务：从用户与写作智能体的交互信号里，判断有哪些关于**作者本人**的持久信息值得写入作者档案。

严格区分两类信息：
- 持久特征（可提炼）：身份、职业、领域专长、经历、价值观、固定写作偏好（如"讨厌感叹号""习惯先给结论"）、平台定位、目标读者。
- 一次性任务约束（绝对不要提炼）：本次字数、本篇结构、某个词的替换、某段的具体改法、临时口吻要求。

输出规则：
1. 只输出 JSON 数组，不要任何解释、不要 markdown 代码块。
2. 每项格式：{"field":"字段名","value":"建议写入的完整取值","reason":"依据，引用原话","confidence":0.0~1.0}
3. field 只能取：${FIELD_HINT}
4. 最多 3 项；没有值得记录的新信息就输出 []
5. value 必须可直接写入档案（自洽的短句），不要写"用户希望…"这种转述
6. 与现有档案重复、或属于一次性任务约束的，一律不要输出`

export interface ExtractResult {
  created: number
  skipped: number
  reason?: string
}

// 提炼入口：source 标记信号来源（stage:outline / manual / finalize）
export async function extractProfile(projectId: number, source: string): Promise<ExtractResult> {
  const config = await getLlmConfig()
  if (!config) return { created: 0, skipped: 0, reason: '未配置模型' }

  const profile = await getProfile()
  const signals = await collectSignals(projectId)
  if (!signals.trim()) return { created: 0, skipped: 0, reason: '暂无可提炼的交互信号' }

  const current = profile
    ? `现有档案（不要重复提炼已有内容）：\n称呼：${profile.name || '（空）'}\n职业领域：${profile.profession || '（空）'}\n背景经历：${profile.background || '（空）'}\n平台定位：${profile.platform || '（空）'}\n目标读者：${profile.audience || '（空）'}`
    : '现有档案：（尚未填写）'

  const out = await chatOnce(config, [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `${current}\n\n交互信号：\n${signals}` }
  ], { temperature: 0.1 })

  const raw = parseJsonLoose<RawProposal[]>(out)
  if (!Array.isArray(raw)) return { created: 0, skipped: 0, reason: '模型未返回可解析结果' }

  let created = 0
  let skipped = 0
  for (const item of raw.slice(0, 5)) {
    const field = (item.field ?? '').trim() as ProfileField
    const value = (item.value ?? '').trim()
    if (!PROFILE_FIELDS.includes(field) || !value) { skipped++; continue }
    if (value.length > 300) { skipped++; continue }

    const currentValue = profile ? (profile as any)[field] ?? '' : ''
    // 已有内容里能包含这个取值 → 无新信息
    if (currentValue.includes(value)) { skipped++; continue }

    await addProposal({
      field,
      current_value: currentValue,
      proposed_value: value,
      reason: (item.reason ?? '').trim().slice(0, 200),
      confidence: typeof item.confidence === 'number' ? item.confidence : 0.5,
      source,
      project_id: projectId
    })
    created++
  }
  return { created, skipped }
}

export { fieldLabel }
