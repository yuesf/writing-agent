<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { addBenchmark, addRubric, getLlmConfig, listBenchmarks, removeRow } from '../core/db'
import { chatStream } from '../core/agent/llm'
import { fetchWechatArticle, pickWechatUrl } from '../core/benchmarkFetcher'
import type { FetchedArticle } from '../core/benchmarkFetcher'
import type { Benchmark } from '../core/types'

const items = ref<Benchmark[]>([])
const err = ref('')
const info = ref('')
const form = ref({
  platform: '公众号', title: '', url: '', author: '',
  published_at: '', excerpt: '', tags: '', metrics: ''
})

// 抓取状态（ADR-017：抓到的全文只在内存，入库的只有摘录）
const linkInput = ref('')
const fetching = ref(false)
const fetched = ref<FetchedArticle | null>(null)
const fetchErr = ref('')
const fetchHint = ref('')
const confirmedUse = ref(false)

const RUBRIC_DIMS = ['信息密度', '结构清晰度', '开头钩子', '风格一致性', '观点锐度', '可读性']

// 边输边判：粘错平台（知乎/小红书）当场提示，不必等点了抓取才发现
const linkInvalid = computed(() => !!linkInput.value.trim() && pickWechatUrl(linkInput.value) === null)

async function reload() {
  items.value = await listBenchmarks()
}
onMounted(reload)

async function doFetch() {
  fetchErr.value = ''
  fetchHint.value = ''
  fetched.value = null
  confirmedUse.value = false
  if (!linkInput.value.trim()) {
    fetchErr.value = '先粘贴公众号文章链接（https://mp.weixin.qq.com/s/...）'
    return
  }
  fetching.value = true
  try {
    fetched.value = await fetchWechatArticle(linkInput.value)
  } catch (e: any) {
    fetchErr.value = String(e?.message ?? e)
  } finally {
    fetching.value = false
  }
}

// 必须人工点一次才填表——抓错一篇不该静默进基准库
function applyFetched() {
  const a = fetched.value
  if (!a) return
  form.value.title = a.title
  form.value.author = a.author
  form.value.url = a.url
  form.value.published_at = a.publishedAt
  form.value.excerpt = a.excerpt
  form.value.platform = '公众号'
  confirmedUse.value = true
  fetchHint.value = `已填表（正文 ${a.chars} 字）。核对标题与摘录后再入库。`
}

async function save() {
  err.value = ''
  const f = form.value
  if (!f.title || !f.excerpt) { err.value = '标题与摘录必填（摘录=特征段落，只存摘录不存全文）'; return }
  await addBenchmark({ ...f })
  const keepTags = f.tags
  form.value = { platform: f.platform, title: '', url: '', author: '', published_at: '', excerpt: '', tags: keepTags, metrics: '' }
  linkInput.value = ''
  fetched.value = null
  confirmedUse.value = false
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
      <p class="muted">
        支持公众号文章粘贴链接自动预填（单篇、你主动触发、抓取结果需你确认后才入库）。
        知乎等其他平台请手动粘贴正文。录入后 AI 跑两条管线：打 Rubric 分（质量门判别用）+ 风格分析入资产库（写作用）。
        建议覆盖不同作者、文体、热度层级。
      </p>
    </div>

    <div class="card">
      <h2>从公众号链接抓取</h2>
      <label>文章链接</label>
      <input v-model="linkInput" placeholder="https://mp.weixin.qq.com/s/..." />
      <p v-if="linkInvalid" class="muted">没识别到公众号链接——目前只支持 mp.weixin.qq.com 的文章，其他平台请手动粘贴正文。</p>
      <button :disabled="fetching" @click="doFetch">{{ fetching ? '抓取中…' : '抓取并预填' }}</button>
      <p v-if="fetchErr" class="err">{{ fetchErr }}</p>

      <template v-if="fetched">
        <div class="card" style="background: var(--bg-soft)">
          <h2>{{ fetched.title || '(未取到标题)' }}</h2>
          <p class="muted">{{ fetched.author || '作者未知' }} · {{ fetched.publishedAt || '时间未知' }} · 正文 {{ fetched.chars }} 字</p>
          <p class="muted">正文预览（前 200 字）：</p>
          <div class="draft">{{ fetched.body.slice(0, 200) }}…</div>
          <button class="primary" @click="applyFetched">填入下面的表单</button>
        </div>
        <p class="muted">抓到的全文只用于 AI 打分，不进数据库；入库的只有摘录。</p>
      </template>
      <p v-if="fetchHint" class="muted">{{ fetchHint }}</p>
    </div>

    <div class="card">
      <h2>录入对标文章</h2>
      <label>平台</label>
      <select v-model="form.platform">
        <option>公众号</option>
        <option>知乎</option>
      </select>
      <p v-if="form.platform !== '公众号'" class="muted">该平台不支持链接抓取，请手动粘贴摘录。</p>
      <label>标题 *</label><input v-model="form.title" />
      <label>作者</label><input v-model="form.author" />
      <label>链接（仅溯源用）</label><input v-model="form.url" />
      <label>发布时间</label><input v-model="form.published_at" type="date" />
      <label>特征摘录 *（开头/金句/代表段落，别贴全文）</label>
      <textarea v-model="form.excerpt"></textarea>
      <label>标签（文体,主题,场景；如：观点文,AI,技术科普）</label><input v-model="form.tags" />
      <label>效果数据（能看到才填，如 阅读2万 在看300）</label><input v-model="form.metrics" />
      <p class="err">{{ err }}</p>
      <p v-if="confirmedUse" class="muted">本次内容来自链接抓取，请确认无误后再点入库。</p>
      <p class="muted">{{ info }}</p>
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
