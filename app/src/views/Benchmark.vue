<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { addBenchmark, addRubric, getLlmConfig, listBenchmarks, removeRow } from '../core/db'
import { chatStream } from '../core/agent/llm'
import type { Benchmark } from '../core/types'

const items = ref<Benchmark[]>([])
const err = ref('')
const info = ref('')
const form = ref({
  platform: '公众号', title: '', url: '', author: '',
  published_at: '', excerpt: '', tags: '', metrics: ''
})

const RUBRIC_DIMS = ['信息密度', '结构清晰度', '开头钩子', '风格一致性', '观点锐度', '可读性']

async function reload() {
  items.value = await listBenchmarks()
}
onMounted(reload)

async function save() {
  err.value = ''
  const f = form.value
  if (!f.title || !f.excerpt) { err.value = '标题与摘录必填（摘录=特征段落，只存摘录不存全文）'; return }
  await addBenchmark({ ...f })
  form.value = { platform: f.platform, title: '', url: '', author: '', published_at: '', excerpt: '', tags: f.tags, metrics: '' }
  await reload()
  info.value = '已入库。建议录入 3~5 篇，覆盖不同作者与文体。'
}

// Rubric 六维 LLM 自动打分（ADR-007：人可覆写；失败不阻塞录入）
async function score(b: Benchmark) {
  err.value = ''
  const cfg = await getLlmConfig()
  if (!cfg) { err.value = '请先在设置里配置模型'; return }
  try {
    const out = await chatStream(cfg, [
      { role: 'system', content: '你是内容质量评审。只输出 JSON，不要多余文字。' },
      { role: 'user', content: `按六维给这篇文章摘录打 1~10 分：${RUBRIC_DIMS.join('、')}。\n摘录：\n${b.excerpt.slice(0, 2000)}\n输出格式：{"信息密度":n,"结构清晰度":n,"开头钩子":n,"风格一致性":n,"观点锐度":n,"可读性":n,"总分":n}` }
    ])
    const json = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)
    await addRubric(b.id, json)
    await reload()
    info.value = `已为《${b.title}》打分`
  } catch (e: any) {
    err.value = String(e?.message ?? e)
  }
}

async function del(id: number) {
  await removeRow('benchmark', id)
  await reload()
}
</script>

<template>
  <div class="page">
    <div class="card">
      <h1>对标基准库</h1>
      <p class="muted">人工逐篇录入（不做任何抓取）。录入后 AI 自动跑两条管线：打 Rubric 分（质量门判别用）+ 风格分析入资产库（写作用）。建议覆盖不同作者、文体、热度层级。</p>
    </div>
    <div class="card">
      <h2>录入对标文章</h2>
      <label>平台</label>
      <select v-model="form.platform"><option>公众号</option><option>知乎</option></select>
      <label>标题 *</label><input v-model="form.title" />
      <label>作者</label><input v-model="form.author" />
      <label>链接（仅溯源用，系统不会访问）</label><input v-model="form.url" />
      <label>发布时间</label><input v-model="form.published_at" type="date" />
      <label>特征摘录 *（开头/金句/代表段落，别贴全文）</label>
      <textarea v-model="form.excerpt"></textarea>
      <label>标签（文体,主题,场景；如：观点文,AI,技术科普）</label><input v-model="form.tags" />
      <label>效果数据（能看到才填，如 阅读2万 在看300）</label><input v-model="form.metrics" />
      <p class="err">{{ err }}</p><p class="muted">{{ info }}</p>
      <button class="primary" @click="save">入库</button>
    </div>
    <div v-for="b in items" :key="b.id" class="card">
      <h2>{{ b.title }} <span class="pill">{{ b.platform }}</span></h2>
      <p class="muted">{{ b.author }} · {{ b.published_at }} · 标签 {{ b.tags || '无' }}</p>
      <p class="muted">{{ b.rubric ? 'Rubric：' + b.rubric : '未打分' }}</p>
      <button @click="score(b)">AI 打分</button>
      <button style="color: var(--warn)" @click="del(b.id)">删除</button>
    </div>
  </div>
</template>
