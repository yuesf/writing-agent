// 三阶段定义（ADR-008 v1 范围：大纲 → 初稿 → 标题/口播）
import type { StageId } from '../types'

export interface StageDef {
  id: StageId
  label: string
  // 该阶段注入的资产类型（ADR-006 检索注入策略表）
  assetTypes: Array<'structure' | 'phrase' | 'sample' | 'fact' | 'rule'>
  // 生成要求提示
  requirement: string
}

export const STAGES: StageDef[] = [
  {
    id: 'outline',
    label: '大纲',
    assetTypes: ['structure', 'fact'],
    requirement: '产出文章大纲：标题 + 3~6 个小节，每节一两句说明要写什么、用什么素材。用 Markdown 输出。'
  },
  {
    id: 'draft',
    label: '初稿',
    assetTypes: ['sample', 'fact'],
    requirement: '按确认过的大纲写全文初稿，Markdown 格式，小节用 ##/###（对接公众号排版交接格式）。'
  },
  {
    id: 'title',
    label: '标题与口播版',
    assetTypes: ['phrase'],
    requirement: '产出 5 个备选标题（各带一句理由）+ 一个口播版开头（60 秒内可讲完）。'
  }
]

export function stageDef(stage: StageId): StageDef {
  return STAGES.find(s => s.id === stage)!
}
