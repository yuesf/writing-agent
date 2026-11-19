# 写作智能体 App（工程骨架）

按 `../DECISIONS.md`（ADR-001~014）实现的 v1 工程骨架：Vue3 + Capacitor + 端侧 SQLite + 自研轻量 Agent Loop。

## 已实现

- **数据层**（`src/core/db/`）：7 张表的 SQLite schema（真机）+ Web localStorage 降级适配器（浏览器 `npm run dev` 即可全流程调试）；事件溯源（`stage_event` 只追加）
- **Agent 核心**（`src/core/agent/`）：
  - `llm.ts` OpenAI 兼容流式客户端（用户自配 base_url/model/api_key，只存本地）
  - `prompt.ts` 六层提示词组装器（系统角色 → Persona 有界摘要 → 配方择优资产 → 个人元素 → 本次要求 → 阶段调整指令），来源强制隔离（self/benchmark/personal），两阶段择优的 v1 实现（标签相关性 + 质量分排序，每维度取 1 个主样本）
  - `machine.ts` 三阶段状态机（大纲 → 初稿 → 标题/口播），人工门禁（初稿必须先确认大纲），事件留痕
- **UI**（`src/views/`）：Onboarding（身份档案 + 模型配置）、项目列表、流水线（生成/草案/确认/调整指令）、对标录入（人工录入 + AI Rubric 打分）、设置（档案/模型/个人元素库）
- **交接包**（`src/core/export/handoff.ts`）：定稿导出 Markdown + YAML front matter（title/digest/author），对接 [wechat-article-writer](https://github.com/yuesf/wechat-article-writer) 的 build_article → preview → draft/add 流程

## 未实现（按 ADR 分期）

- embedding 检索（v2，`prompt.ts` 的 `pickAssets` 当前用标签相关性降级）
- 回路 2/3 全流程（反馈蒸馏、Rubric 校准、复盘报告）——v1 已埋事件数据
- 对标文章的风格资产化自动拆解（管线 B）——当前对标仅打分，风格资产可在设置页手工录入
- 真机文件导出（@capacitor/filesystem）、Android 原生构建产物
- LLM 用量统计、敏感标记的完整 UI（schema 字段已就位）

## 运行

```bash
cd app
npm install
npm run dev        # 浏览器调试（数据存 localStorage）
npm run build      # 产出 dist/
npx cap add android
npm run cap:sync   # 同步到 Android 工程
npm run cap:open   # Android Studio 构建签名 APK
```

## 发布链路（对接 wechat-article-writer）

1. APK 三阶段全部确认 → 「导出交接包」得到 `handoff-<标题>.md`
2. 传到电脑（系统分享/文件传输助手）
3. 桌面 WorkBuddy 按 wechat-article-writer 的 SKILL.md 执行：`build_article.py` 生成预览 → 核对 → `push.sh` 写草稿箱
4. 公众号后台人工确认发表（本产品与 skill 都不做自动发布）
