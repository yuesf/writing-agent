// 领域类型 —— 唯一权威定义，对应 ADR-005/013/014 的数据模型
export interface UserProfile {
  id: number
  name: string // 称呼
  profession: string // 职业/领域
  background: string // 身份背景与经历简介
  platform: string // 写作平台与账号定位
  audience: string // 目标读者
  updated_at: string
}

export interface LlmConfig {
  id: number
  base_url: string // OpenAI 兼容端点，如 https://api.deepseek.com/v1
  model: string
  api_key: string
  updated_at: string
}

export type StageId = 'outline' | 'draft' | 'title' // v1 三阶段（ADR-008）
export type StageStatus = 'pending' | 'generating' | 'draft' | 'confirmed'

export interface StageState {
  id: number
  project_id: number
  stage: StageId
  status: StageStatus
  draft: string
  directive: string // Stage 级调整指令（ADR-013），触发重生成
  updated_at: string
}

export interface Project {
  id: number
  title: string
  topic_brief: string // 选题描述（两阶段择优的相关性锚点，ADR-009）
  requirements: string // Project 级本次写作要求（字数/口吻/必含点/平台）
  status: 'writing' | 'done'
  created_at: string
  updated_at: string
}

export interface Benchmark {
  id: number
  platform: string // 公众号 / 知乎
  title: string
  url: string
  author: string
  published_at: string
  excerpt: string // 只存特征与摘录（ADR-007 禁抓取）
  tags: string // 逗号分隔：文体,主题,场景
  metrics: string // 人工录入的效果数据，可空
  rubric: string // LLM 打分 JSON，人可覆写
  created_at: string
}

export type AssetType = 'sample' | 'structure' | 'phrase' | 'fact' | 'rule' | 'personal'
export type AssetSource = 'self' | 'benchmark' | 'personal' // 来源强制隔离（ADR-009）

export interface Asset {
  id: number
  type: AssetType
  source: AssetSource
  content: string
  tags: string
  quality: number // 采纳率/Rubric 总分，择优排序用
  sensitive: number // 1 = 不进提示词、不做 embedding（ADR-011 C）
  created_at: string
}

// 事件溯源（ADR-010 借鉴 DeepSeek Harness）：只追加，不修改
export interface StageEvent {
  id: number
  project_id: number
  stage: StageId
  event: string // generate_started | draft_saved | directive_added | confirmed | reverted
  payload: string
  created_at: string
}
