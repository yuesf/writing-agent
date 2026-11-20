// 工作流状态机（ADR-004 人工门禁 + ADR-010 事件溯源）
// 状态转移：pending → generating → draft → (confirm) confirmed / (revise) generating
import type { StageId } from '../types'
import { appendEvent, getLlmConfig, getProfile, getProject, getStages, listAssets, setStage, updateProject } from '../db'
import { chatStream } from './llm'
import { buildPrompt } from './prompt'
import { extractProfile } from './profileLearn'
import { stageDef } from './stages'

// 生成某阶段草案（流式，onDelta 供 UI 实时渲染）
export async function generateStage(
  projectId: number,
  stage: StageId,
  onDelta?: (text: string) => void
): Promise<string> {
  const config = await getLlmConfig()
  if (!config) throw new Error('请先在「设置」中配置 LLM（接口地址 / 模型 / API Key）')

  const project = await getProject(projectId)
  if (!project) throw new Error('项目不存在')

  const stages = await getStages(projectId)
  const cur = stages.find(s => s.stage === stage)
  if (!cur) throw new Error('阶段不存在')

  const def = stageDef(stage)
  if (def.assetTypes.length === 0) throw new Error('阶段定义错误')

  // 初稿阶段依赖已确认的大纲（人工门禁：上游未确认不允许进入，ADR-004）
  if (stage === 'draft') {
    const outline = stages.find(s => s.stage === 'outline')!
    if (outline.status !== 'confirmed') throw new Error('请先确认大纲，再生成初稿')
  }

  const [profile, assets] = await Promise.all([getProfile(), listAssets()])
  const prevConfirmed = stage === 'draft' ? stages.find(s => s.stage === 'outline')!.draft : ''

  await setStage(cur.id, { status: 'generating' })
  await appendEvent(projectId, stage, 'generate_started', { directive: cur.directive })

  try {
    const draft = await chatStream(config, buildPrompt(profile, project, cur, assets, prevConfirmed), onDelta)
    await setStage(cur.id, { draft, status: 'draft' })
    await appendEvent(projectId, stage, 'draft_saved', { length: draft.length })
    return draft
  } catch (e: any) {
    await setStage(cur.id, { status: cur.draft ? 'draft' : 'pending' })
    await appendEvent(projectId, stage, 'generate_failed', { error: String(e?.message ?? e) })
    throw e
  }
}

// 人工门禁确认（采纳率指标的数据源，ADR-011 E）
// 确认即触发一次档案提炼（ADR-015）：派生动作，失败不影响确认本身
export async function confirmStage(projectId: number, stage: StageId): Promise<number> {
  const stages = await getStages(projectId)
  const cur = stages.find(s => s.stage === stage)
  if (!cur || cur.status !== 'draft') throw new Error('当前没有可确认的草案')
  await setStage(cur.id, { status: 'confirmed', directive: '' })
  await appendEvent(projectId, stage, 'confirmed', {})
  await touchProject(projectId)

  try {
    const r = await extractProfile(projectId, `stage:${stage}`)
    return r.created
  } catch {
    return 0 // 提炼失败不阻塞写作主流程
  }
}

// 阶段调整指令（ADR-013 Stage 级）：留痕后重新生成
export async function reviseStage(projectId: number, stage: StageId, directive: string, onDelta?: (t: string) => void): Promise<string> {
  const stages = await getStages(projectId)
  const cur = stages.find(s => s.stage === stage)
  if (!cur) throw new Error('阶段不存在')
  await setStage(cur.id, { directive })
  await appendEvent(projectId, stage, 'directive_added', { directive })
  return generateStage(projectId, stage, onDelta)
}

async function touchProject(projectId: number): Promise<void> {
  await updateProject(projectId, {})
}
