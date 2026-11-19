// 六层提示词组装器（ADR-013 固定顺序）：系统角色 → Persona 有界摘要 → 配方择优资产 → 个人元素 → 本次要求 → 阶段调整指令
import type { Asset, Project, StageState, UserProfile } from '../types'
import type { ChatMessage } from './llm'
import { stageDef } from './stages'

// 有界预算（ADR-010 借鉴 Hermes 有界记忆）：各层 token 上限（中文按 ~1.5 char/token 粗估）
const LIMITS = { persona: 1200, assets: 1600, personal: 800, requirements: 400, directive: 400 }

function clip(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars) + '\n…(已截断)' : text
}

// 两阶段择优（ADR-009）：v1 用标签相关性 + 质量分排序；embedding 检索 v2 接入（见 rankAssets TODO）
export function pickAssets(assets: Asset[], stageAssetTypes: string[], topicBrief: string, source: 'self' | 'benchmark' | 'personal'): Asset[] {
  const kw = topicBrief.split(/[\s，。、]+/).filter(w => w.length >= 2)
  const score = (a: Asset) => {
    let s = a.quality ?? 0
    if (kw.some(w => (a.content + a.tags).includes(w))) s += 100 // 相关性优先
    return s
  }
  const picked: Asset[] = []
  for (const t of stageAssetTypes) {
    const candidates = assets
      .filter(a => a.type === t && a.source === source && !a.sensitive)
      .sort((x, y) => score(y) - score(x))
    if (candidates.length) picked.push(candidates[0]) // 每维度只取 1 个最优主样本
  }
  return picked
}

export function buildPrompt(
  profile: UserProfile | null,
  project: Project,
  stage: StageState,
  assets: Asset[],
  previousDraft: string
): ChatMessage[] {
  const def = stageDef(stage.stage)

  // 第 1 层：系统角色
  const sys = '你是一个写作智能体，服务于长文写作流水线中的一个阶段。严格按用户要求输出，不编造事实与数据，无法核实的内容标注"待补充"。'

  // 第 2 层：Persona 有界摘要（用户档案，ADR-014 身份层）
  const persona = profile
    ? clip(`作者档案：称呼 ${profile.name}；领域 ${profile.profession}；背景：${profile.background}；平台定位：${profile.platform}；目标读者：${profile.audience}`, LIMITS.persona)
    : '（作者档案未填写，使用通用风格）'

  // 第 3 层：配方择优资产（v1 默认对标源优先，无则用自我；来源强制隔离见 ADR-009）
  const src = assets.some(a => a.source === 'benchmark' && !a.sensitive) ? 'benchmark' : 'self'
  const picked = pickAssets(assets, def.assetTypes, project.topic_brief, src)
  const assetText = picked.length
    ? clip('参考资产（风格与素材，模仿其写法但不要照抄内容）：\n' + picked.map(a => `[${a.type}] ${a.content}`).join('\n---\n'), LIMITS.assets)
    : '（暂无可用参考资产，使用通用写法）'

  // 第 4 层：个人元素（ADR-013）
  const personal = assets.filter(a => a.type === 'personal' && !a.sensitive)
  const personalText = personal.length
    ? clip('作者个人元素（自然融入，不要堆砌）：\n' + personal.map(a => `- ${a.content}`).join('\n'), LIMITS.personal)
    : ''

  // 第 5 层：本次写作要求（Project 级）
  const req = project.requirements ? clip(`本次写作要求：${project.requirements}`, LIMITS.requirements) : ''

  // 第 6 层：阶段调整指令（Stage 级，一次性）
  const dir = stage.directive ? clip(`本阶段调整指令：${stage.directive}`, LIMITS.directive) : ''
  const prev = stage.stage === 'draft' && previousDraft ? `已确认的大纲如下，严格按此展开：\n${clip(previousDraft, 2000)}` : ''

  const user = [
    `当前阶段：${def.label}`,
    def.requirement,
    `选题：${project.title} —— ${project.topic_brief}`,
    prev,
    persona,
    assetText,
    personalText,
    req,
    dir
  ]
    .filter(Boolean)
    .join('\n\n')

  return [
    { role: 'system', content: sys },
    { role: 'user', content: user }
  ]
}
