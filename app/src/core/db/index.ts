// 领域数据访问：一套领域函数，双后端（真机 SQLite / Web 降级）
import type { Row, StorageBackend } from './adapter'
import { SqliteBackend, WebBackend } from './adapter'
import { Capacitor } from '@capacitor/core'
import type { Asset, Benchmark, LlmConfig, LlmDraft, ProfileHistory, ProfileProposal, Project, StageEvent, StageId, StageState, UserProfile } from '../types'
import { providerByUrl } from '../providers'

let backend: StorageBackend | null = null
let initPromise: Promise<StorageBackend> | null = null

export async function ensureDb(): Promise<StorageBackend> {
  if (backend) return backend
  // 并发调用只初始化一次；失败时不缓存半成品后端，让错误上抛并可重试
  if (!initPromise) {
    initPromise = (async () => {
      const b = Capacitor.isNativePlatform() ? new SqliteBackend() : new WebBackend()
      await b.init()
      backend = b
      return b
    })().catch(e => {
      initPromise = null
      throw e
    })
  }
  return initPromise
}

function now(): string {
  return new Date().toISOString()
}

// ---------- 用户档案（ADR-014 身份层） ----------
export async function getProfile(): Promise<UserProfile | null> {
  const rows = await (await ensureDb()).list('user_profile')
  return (rows[0] as UserProfile) ?? null
}

export async function saveProfile(p: Omit<UserProfile, 'id' | 'updated_at'>): Promise<void> {
  const b = await ensureDb()
  const existing = await b.list('user_profile')
  if (existing.length) await b.update('user_profile', existing[0].id, { ...p, updated_at: now() })
  else await b.insert('user_profile', { ...p, updated_at: now() })
}

// ---------- LLM 配置 ----------
export async function getLlmConfig(): Promise<LlmConfig | null> {
  const rows = await (await ensureDb()).list('llm_config')
  const row = rows[0]
  if (!row) return null
  // 老配置没有 provider 字段：按接口地址反查，反查不到视为自定义，避免每次都要重选
  const provider = row.provider || providerByUrl(row.base_url || '')?.id || 'custom'
  return { ...(row as LlmConfig), provider }
}

export async function saveLlmConfig(c: LlmDraft): Promise<void> {
  const b = await ensureDb()
  const existing = await b.list('llm_config')
  if (existing.length) await b.update('llm_config', existing[0].id, { ...c, updated_at: now() })
  else await b.insert('llm_config', { ...c, updated_at: now() })
}

// ---------- 项目 ----------
export async function createProject(title: string, topic_brief: string, requirements: string): Promise<number> {
  const b = await ensureDb()
  const id = await b.insert('project', { title, topic_brief, requirements, status: 'writing', created_at: now(), updated_at: now() })
  for (const stage of ['outline', 'draft', 'title'] as StageId[])
    await b.insert('stage_state', { project_id: id, stage, status: 'pending', draft: '', directive: '', updated_at: now() })
  await appendEvent(id, 'outline', 'project_created', { title })
  return id
}

export async function listProjects(): Promise<Project[]> {
  const rows = await (await ensureDb()).list('project')
  return rows.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)) as Project[]
}

export async function getProject(id: number): Promise<Project | null> {
  const rows = await (await ensureDb()).list('project')
  return (rows.find(r => r.id === id) as Project) ?? null
}

export async function updateProject(id: number, patch: Partial<Project>): Promise<void> {
  await (await ensureDb()).update('project', id, { ...patch, updated_at: now() })
}

// ---------- 阶段状态（事件溯源：状态可由事件重建，ADR-010） ----------
export async function getStages(projectId: number): Promise<StageState[]> {
  const rows = await (await ensureDb()).list('stage_state')
  const order: StageId[] = ['outline', 'draft', 'title']
  return rows
    .filter(r => r.project_id === projectId)
    .sort((a, b) => order.indexOf(a.stage as StageId) - order.indexOf(b.stage as StageId)) as StageState[]
}

export async function setStage(stageId: number, patch: Partial<StageState>): Promise<void> {
  await (await ensureDb()).update('stage_state', stageId, { ...patch, updated_at: now() })
}

export async function appendEvent(projectId: number, stage: StageId, event: string, payload: any = {}): Promise<void> {
  await (await ensureDb()).insert('stage_event', { project_id: projectId, stage, event, payload: JSON.stringify(payload), created_at: now() })
}

export async function listEvents(projectId: number): Promise<StageEvent[]> {
  const rows = await (await ensureDb()).list('stage_event')
  return rows.filter(r => r.project_id === projectId) as StageEvent[]
}

// ---------- 对标基准库（ADR-007：全人工录入；ADR-019：风格自动归类） ----------
export async function addBenchmark(
  b: Omit<Benchmark, 'id' | 'created_at' | 'rubric' | 'style_id' | 'style_name'>
): Promise<number> {
  return (await ensureDb()).insert('benchmark', {
    ...b, rubric: '', style_id: 0, style_name: '', created_at: now()
  })
}

export async function listBenchmarks(): Promise<Benchmark[]> {
  const rows = (await (await ensureDb()).list('benchmark')) as Benchmark[]
  // 老库刚迁移完这两列可能是 null，统一补成默认值，UI 不必到处判空
  return rows
    .map(r => ({ ...r, style_id: Number(r.style_id) || 0, style_name: r.style_name || '' }))
    .reverse()
}

// Rubric 打分（LLM 自动打，人可覆写 —— ADR-007）
export async function addRubric(id: number, rubric: string): Promise<void> {
  await (await ensureDb()).update('benchmark', id, { rubric })
}

// 归入某风格档案；styleId=0 表示解绑
export async function setBenchmarkStyle(id: number, styleId: number, styleName: string): Promise<void> {
  await (await ensureDb()).update('benchmark', id, { style_id: styleId, style_name: styleName })
}

// ---------- 资产库（ADR-006/009/013：六类资产，来源隔离） ----------
export async function addAsset(a: Omit<Asset, 'id' | 'created_at'>): Promise<number> {
  return (await ensureDb()).insert('asset', { ...a, created_at: now() })
}

export async function listAssets(filter?: { type?: string; source?: string }): Promise<Asset[]> {
  let rows = (await (await ensureDb()).list('asset')) as Asset[]
  if (filter?.type) rows = rows.filter(r => r.type === filter.type)
  if (filter?.source) rows = rows.filter(r => r.source === filter.source)
  return rows
}

export async function updateAsset(id: number, patch: Partial<Omit<Asset, 'id' | 'created_at'>>): Promise<void> {
  await (await ensureDb()).update('asset', id, patch)
}

export async function removeRow(table: string, id: number): Promise<void> {
  await (await ensureDb()).remove(table, id)
}

// ---------- 档案演化（ADR-015）：候选事实 → 人工确认 → 合并 + 快照 ----------
export async function addProposal(p: Omit<ProfileProposal, 'id' | 'created_at' | 'resolved_at' | 'status'>): Promise<number> {
  return (await ensureDb()).insert('profile_proposal', { ...p, status: 'pending', created_at: now(), resolved_at: '' })
}

export async function listProposals(status?: 'pending' | 'accepted' | 'rejected'): Promise<ProfileProposal[]> {
  let rows = (await (await ensureDb()).list('profile_proposal')) as ProfileProposal[]
  if (status) rows = rows.filter(r => r.status === status)
  return rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

// 采纳：先存快照，再按字段策略合并（background 累积追加，其余覆盖）
export async function resolveProposal(id: number, accept: boolean): Promise<void> {
  const b = await ensureDb()
  const rows = (await b.list('profile_proposal')) as ProfileProposal[]
  const prop = rows.find(r => r.id === id)
  if (!prop || prop.status !== 'pending') return

  if (accept) {
    const profile = await getProfile()
    if (!profile) throw new Error('档案不存在')
    await snapshotProfile(`采纳档案建议：${prop.field}`)

    const value = prop.proposed_value.trim()
    const next: any = {
      name: profile.name,
      profession: profile.profession,
      background: profile.background,
      platform: profile.platform,
      audience: profile.audience
    }
    if (prop.field === 'background') {
      // 背景类是经历累积：不覆盖，去重后追加
      if (!next.background.includes(value)) next.background = next.background ? `${next.background}；${value}` : value
    } else {
      next[prop.field] = value
    }
    await saveProfile(next)
  }

  await b.update('profile_proposal', id, { status: accept ? 'accepted' : 'rejected', resolved_at: now() })
}

async function snapshotProfile(reason: string): Promise<void> {
  const profile = await getProfile()
  if (!profile) return
  await (await ensureDb()).insert('profile_history', { snapshot: JSON.stringify(profile), reason, created_at: now() })
}

export async function listProfileHistory(): Promise<ProfileHistory[]> {
  const rows = (await (await ensureDb()).list('profile_history')) as ProfileHistory[]
  return rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

// 回滚到上一次快照（只回滚一次，用完即弃，可连续回滚）
export async function rollbackProfile(): Promise<boolean> {
  const b = await ensureDb()
  const history = await listProfileHistory()
  const last = history[0]
  if (!last) return false
  const rows = await b.list('user_profile')
  if (!rows.length) return false
  const snap = JSON.parse(last.snapshot)
  await b.update('user_profile', rows[0].id, {
    name: snap.name ?? '',
    profession: snap.profession ?? '',
    background: snap.background ?? '',
    platform: snap.platform ?? '',
    audience: snap.audience ?? '',
    updated_at: now()
  })
  await b.remove('profile_history', last.id)
  return true
}

export type { Row }
