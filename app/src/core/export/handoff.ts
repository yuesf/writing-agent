// skill 交接包导出（ADR-012）：定稿 Markdown + front matter
// 交接格式对齐 wechat-article-writer：小标题 ##/###，front matter 提供 title/digest/author
// v1 Web 环境：Blob 下载；真机 v2 可换 @capacitor/filesystem 写入并分享
import type { Project, StageState } from '../types'

export async function exportHandoff(project: Project, stages: StageState[]): Promise<void> {
  const outline = stages.find(s => s.stage === 'outline')
  const draft = stages.find(s => s.stage === 'draft')
  const title = stages.find(s => s.stage === 'title')
  if (!draft?.draft) throw new Error('初稿尚未确认')

  const digest = (project.topic_brief || '').slice(0, 60)
  const author = '' // 由用户在公众号后台或 skill 参数中补充

  const head = [
    '---',
    `title: "${project.title.replace(/"/g, "'")}"`,
    `digest: "${digest.replace(/"/g, "'")}"`,
    `author: "${author}"`,
    `project_id: ${project.id}`,
    '---',
    ''
  ].join('\n')

  const body = [
    `# ${project.title}`,
    '',
    draft.draft,
    '',
    '---',
    '',
    '## 附：已确认大纲',
    '',
    outline?.draft ?? '（无）',
    '',
    '## 附：标题与口播候选',
    '',
    title?.draft ?? '（无）',
    ''
  ].join('\n')

  const content = head + body

  if (typeof document !== 'undefined') {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const safe = project.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 30)
    a.href = url
    a.download = `handoff-${safe}.md`
    a.click()
    URL.revokeObjectURL(url)
  } else {
    // 真机：v2 接 @capacitor/filesystem + Share
    throw new Error('真机导出将在 v2 接入文件系统，当前请用浏览器版')
  }
}
