# 写作智能体 App（工程骨架）

按 `../DECISIONS.md`（ADR-001~020）实现的 v1 工程骨架：Vue3 + Capacitor + 端侧 SQLite + 自研轻量 Agent Loop。

## 已实现

- **数据层**（`src/core/db/`）：9 张表的 SQLite schema（真机）+ Web localStorage 降级适配器（浏览器 `npm run dev` 即可全流程调试）；事件溯源（`stage_event` 只追加）
- **Agent 核心**（`src/core/agent/`）：
  - `llm.ts` OpenAI 兼容客户端，走 `core/http.ts` 统一层（详见下方"模型配置与网络"）
  - `prompt.ts` 六层提示词组装器（系统角色 → Persona 有界摘要 → 配方择优资产 → 个人元素 → 本次要求 → 阶段调整指令），来源强制隔离（self/benchmark/personal），两阶段择优的 v1 实现（标签相关性 + 质量分排序，每维度取 1 个主样本）
  - `machine.ts` 三阶段状态机（大纲 → 初稿 → 标题/口播），人工门禁（初稿必须先确认大纲），事件留痕
- **模型配置**（`src/core/providers.ts` + `views/ModelConfigForm.vue`）：服务商下拉（DeepSeek / MiniMax）→ 接口地址自动带出 → 填 Key → 一键拉取模型列表 → 下拉选模型。详见"模型配置与网络"。
- **对标链接抓取**（`src/core/benchmarkFetcher.ts`）：粘贴公众号链接 → 抓取标题/作者/日期/正文 → **直接入库**（不二次确认，带撤销条与 URL 去重）。**只支持公众号**（知乎需登录态，实测 403）；**这是对标库的唯一入口**，没有手动录入表单（ADR-020）；抓到的全文只在内存，入库只有摘录；只在真机可用（浏览器受同源策略限制）。
- **风格自动划分**（`src/core/agent/styleCluster.ts` + `styleProfile.ts`，ADR-019）：对标库一键划分写作风格 → `asset(type='style')` 存风格档案（文体/语气/结构骨架/开头方式/人称/句式/术语密度/段落节奏）→ 初稿阶段只注入 1 个（质量分最高的那个）。增量归属而非一次性聚类，风格 id 稳定，可反复补跑。
- **UI**（`src/views/`）：Onboarding（身份档案 + 模型配置）、项目列表、流水线（生成/草案/确认/调整指令）、对标录入（链接抓取即入库 + AI Rubric 打分 + 风格自动划分）、设置（档案/模型/个人元素库）
- **交接包**（`src/core/export/handoff.ts`）：定稿导出 Markdown + YAML front matter（title/digest/author），对接 [wechat-article-writer](https://github.com/yuesf/wechat-article-writer) 的 build_article → preview → draft/add 流程

## 未实现（按 ADR 分期）

- embedding 检索（v2，`prompt.ts` 的 `pickAssets` 当前用标签相关性降级；风格选择当前按 Rubric 质量分择优）
- 回路 2/3 全流程（反馈蒸馏、Rubric 校准、复盘报告）——v1 已埋事件数据
- 风格档案的人工精修 UI（当前档案由 LLM 生成、只读；要改得直接改 asset 行）
- 真机文件导出（@capacitor/filesystem）——当前导出走浏览器下载/剪贴板；debug APK 已可构建，正式签名包待配 keystore
- LLM 用量统计、敏感标记的完整 UI（schema 字段已就位）

## 模型配置与网络

**配置流程**：选服务商 → 接口地址自动带出（不可手改）→ 填 API Key → 点「获取模型列表」→ 下拉选模型。
内置 DeepSeek / MiniMax 两家（首版曾支持 9 家，已按主力两家收敛）。

- 各家的 OpenAI 兼容端点写在 `src/core/providers.ts`，改地址只改这一个文件。
- 模型列表**只能**来自 `GET {base_url}/models`，客户端不内置任何模型清单（内置的会过期，用户选到已下线的型号更难查）；自动过滤 embedding / rerank / tts / whisper / image 等非对话模型。
- 拉不到（401/404/空返回）就把真实错误提示出来，下拉保持空并禁用；此时可点「手动填写模型名」自己输入型号。

**为什么有一个 `core/http.ts`**：真机 WebView 的 origin 是 `https://localhost`，直连第三方 API 会被同源策略拦截（服务商不会为客户端开 CORS 头）。所以真机走 `CapacitorHttp` 原生栈（Bridge 自动注册，无需配置），浏览器开发态走 `fetch`。

**已知代价**：原生栈拿不到 SSE 流，真机上 `chatStream` 是一次性返回后整体渲染；流式打字机效果只在浏览器生效。


```bash
cd app
npm install
npm run dev        # 浏览器调试（数据存 localStorage）
npm run build      # 产出 dist/
npx cap add android
npm run cap:sync   # 同步到 Android 工程
npm run cap:open   # Android Studio 构建签名 APK
```

### 命令行出 APK（Windows 实测可用）

环境前置：JDK 17、Android SDK（platform-tools / platforms;android-34 / build-tools;34.0.0）。
国内网络无法直连 `dl.google.com`，SDK 组件可用腾讯云镜像安装：
`SDK_TEST_BASE_URL=https://mirrors.cloud.tencent.com/AndroidSDK/ sdkmanager --install platform-tools "platforms;android-34" "build-tools;34.0.0"`

```bash
cd app/android
./gradlew assembleDebug -Dorg.gradle.java.home=/d/Java/jdk-17
# 产物：app/build/outputs/apk/debug/app-debug.apk
```

两个必须显式指定的坑：
1. `-Dorg.gradle.java.home=` 不能省 —— 本机全局 `~/.gradle/gradle.properties` 里 `org.gradle.java.home` 指向 JDK 8，AGP 8.2.1 会直接解析失败。
2. `~/.gradle/init.gradle` 注入的阿里云仓库必须是 `https://`（Gradle 8 拒绝明文 http）。

### 装到真机

部分国产 ROM（如 StepX / Flyme 系）会拦 `adb install`，报 `INSTALL_FAILED_USER_RESTRICTED`。
绕过办法是走安装器直装：

```bash
adb push app-debug.apk /data/local/tmp/wa.apk
adb shell pm install -r -d /data/local/tmp/wa.apk    # 输出 Success 即成功
adb shell am start -n com.yuesf.writingagent/.MainActivity
```

> Git Bash 下 `adb push` 的 `/data/...` 会被转成 Windows 路径，前面加 `MSYS_NO_PATHCONV=1`。

## 发布链路（对接 wechat-article-writer）

1. APK 三阶段全部确认 → 「导出交接包」得到 `handoff-<标题>.md`
2. 传到电脑（系统分享/文件传输助手）
3. 桌面 WorkBuddy 按 wechat-article-writer 的 SKILL.md 执行：`build_article.py` 生成预览 → 核对 → `push.sh` 写草稿箱
4. 公众号后台人工确认发表（本产品与 skill 都不做自动发布）
