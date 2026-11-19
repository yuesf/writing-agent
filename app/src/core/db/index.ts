// 领域数据访问：一套领域函数，双后端（真机 SQLite / Web 降级）
import type { Row, StorageBackend } from './adapter'
import { SqliteBackend, WebBackend } from './adapter'
import { Capacitor } from '@capacitor/core'
import type { Asset, Benchmark, LlmConfig, Project, StageEvent, StageId, StageState, UserProfile } from '../types'

let backend: StorageBackend | null = null

export async function ensureDb(): Promise<StorageBackend> {
  if (!backend) {
    backend = Capacitor.isNativePlatform() ? new SqliteBackend() : new WebBackend()
    await backend.init()
  }
  return backend
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
  return (rows[0] as LlmConfig) ?? null
}

export async function saveLlmConfig(c: Omit<LlmConfig, 'id' | 'updated_at'>): Promise<void> {
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

// ---------- 对标基准库（ADR-007：全人工录入） ----------
export async function addBenchmark(b: Omit<Benchmark, 'id' | 'created_at' | 'rubric'>): Promise<number> {
  return (await ensureDb()).insert('benchmark', { ...b, rubric: '', created_at: now() })
}

export async function listBenchmarks(): Promise<Benchmark[]> {
  const rows = await (await ensureDb()).list('benchmark')
  return rows.reverse() as Benchmark[]
}

// Rubric 打分（LLM 自动打，人可覆写 —— ADR-007）
export async function addRubric(id: number, rubric: string): Promise<void> {
  await (await ensureDb()).update('benchmark', id, { rubric })
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

export async function removeRow(table: string, id: number): Promise<void> {
  await (await ensureDb()).remove(table, id)
}

export type { Row }
