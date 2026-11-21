<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { addBenchmark, addRubric, getLlmConfig, listAssets, listBenchmarks, removeRow } from '../core/db'
import { chatStream } from '../core/agent/llm'
import { clusterBenchmarkStyles, detachBenchmarkStyles, styleNameOf, syncStyleQuality } from '../core/agent/styleCluster'
import { fetchWechatArticle, pickWechatUrl } from '../core/benchmarkFetcher'
import type { Asset, Benchmark } from '../core/types'

const items = ref<Benchmark[]>([])
const err = ref('')
const info = ref('')

// 抓取即入库（ADR-018）：抓取成功当场写库，不再二次确认；
// 失败一律不入库，成功后提供一次性「撤销」，比多点一次确认更省事。
const linkInput = ref('')
const ingesting = ref(false)
const fetchErr = ref('')
const lastIngested = ref<{ id: number; title: string; author: string; chars: number } | null>(null)

// 风格自动划分（ADR-019）
const styles = ref<Asset[]>([])
const clustering = ref(false)
const clusterMsg = ref('')
const clusterErr = ref('')

// 页面内两个页签：文章库（攒样本）/ 写作风格（归纳成可注入的写法）
const pane = ref<'articles' | 'styles'>('articles')

const RUBRIC_DIMS = ['信息密度', '结构清晰度', '开头钩子', '风格一致性', '观点锐度', '可读性']

// 边输边判：粘错平台（知乎/小红书）当场提示，不必等点了抓取才发现
const linkInvalid = computed(() => !!linkInput.value.trim() && pickWechatUrl(linkInput.value) === null)

const pendingCount = computed(() => items.value.filter(b => !b.style_id && (b.excerpt ?? '').length >= 100).length)
const unstyledCount = computed(() => items.value.filter(b => !b.style_id).length)

// 风格 → 篇数/篇目由 benchmark.style_id 现算，不维护冗余计数（少一处会不一致的状态）
const styleGroups = computed(() =>
  styles.value
    .map(st => ({
      id: st.id,
      name: styleNameOf(st),
      summary: (st.content.split('\n').find(l => l.startsWith('一句话：')) ?? '').replace('一句话：', ''),
      quality: st.quality ?? 0,
      members: items.value.filter(b => b.style_id === st.id)
    }))
    .filter(g => g.members.length)
    .sort((a, b) => b.members.length - a.members.length)
)

async function reload() {
  items.value = await listBenchmarks()
  styles.value = await listAssets({ type: 'style', source: 'benchmark' })
  // 质量分 = 该风格下 Rubric 均值，打分/删文/撤销后都会过期。
  // 全部归类后划分按钮是禁用的，用户没别的办法刷新，所以在这里统一收敛一次（幂等，无变化不写库）。
  if (await syncStyleQuality()) styles.value = await listAssets({ type: 'style', source: 'benchmark' })
}
onMounted(reload)

function sameUrl(a: string, b: string): boolean {
  return (a ?? '').trim() === (b ?? '').trim() && !!a
}

// 两个页签高度差很大，停在原滚动位置会落到空白处，切完统一回顶部
function switchPane(p: 'articles' | 'styles') {
  if (pane.value === p) return
  pane.value = p
  window.scrollTo({ top: 0 })
}

async function doIngest() {
  fetchErr.value = ''
  info.value = ''
  lastIngested.value = null
  if (!linkInput.value.trim()) {
    fetchErr.value = '先粘贴公众号文章链接（https://mp.weixin.qq.com/s/...）'
    return
  }
  const url = pickWechatUrl(linkInput.value)
  if (!url) {
    fetchErr.value = '只识别公众号文章链接（https://mp.weixin.qq.com/s/...），其他链接抓不到正文。'
    return
  }
  // 去重：同一条链接重复入库会让风格样本和 Rubric 重复计权，先挡掉
  const dup = items.value.find(b => sameUrl(b.url, url))
  if (dup) {
    fetchErr.value = `这篇已经在库里了：《${dup.title}》，没有重复入库。`
    return
  }

  ingesting.value = true
  try {
    const a = await fetchWechatArticle(url)
    const title = a.title || '未取到标题的公众号文章'
    const id = await addBenchmark({
      platform: '公众号',
      title,
      url: a.url,
      author: a.author,
      published_at: a.publishedAt,
      excerpt: a.excerpt,
      tags: '',
      metrics: ''
    })
    await reload()
    lastIngested.value = { id, title, author: a.author, chars: a.chars }
    info.value = `已入库：《${title}》· 正文 ${a.chars} 字，库里只存摘录 ${a.excerpt.length} 字。`
    linkInput.value = ''
  } catch (e: any) {
    fetchErr.value = String(e?.message ?? e)
  } finally {
    ingesting.value = false
  }
}

// 抓错了不用去列表里找，直接撤掉刚写的那条
async function undoLast() {
  const last = lastIngested.value
  if (!last) return
  await removeRow('benchmark', last.id)
  lastIngested.value = null
  info.value = `已撤销：《${last.title}》`
  await reload()
}

// 只划分还没归类的文章：增量跑，已归档的不动，风格 id 保持稳定
async function runCluster() {
  clusterErr.value = ''
  clusterMsg.value = ''
  if (!pendingCount.value) {
    clusterMsg.value = unstyledCount.value
      ? '未归类的文章摘录都太短（需要 ≥100 字），先在文章里补摘录'
      : '没有待划分的文章'
    return
  }
  const cfg = await getLlmConfig()
  if (!cfg) {
    clusterErr.value = '请先在设置里配置模型——划分风格要调用 LLM'
    return
  }
  clustering.value = true
  try {
    const r = await clusterBenchmarkStyles(cfg, p => {
      clusterMsg.value = `分析中 ${p.index}/${p.total}：《${p.title}》`
    })
    await reload()
    clusterMsg.value =
      `完成：新建 ${r.created} 个风格，归入已有风格 ${r.joined} 篇` +
      (r.failed ? `，${r.failed} 篇失败（再点一次可重试）` : '') +
      '。'
  } catch (e: any) {
    clusterErr.value = `划分失败：${String(e?.message ?? e)}`
  } finally {
    clustering.value = false
  }
}

// 删风格档案要先把文章解绑，否则 benchmark 会指向不存在的 id
async function delStyle(id: number) {
  await detachBenchmarkStyles(id)
  await removeRow('asset', id)
  await reload()
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
        公众号文章粘贴链接即抓取入库（单篇、你主动触发），抓取失败不入库，入库后可点「撤销」删掉刚写的那篇。
        目前只接公众号——知乎等平台需登录态，拿不到正文。
        下面分两块：<b>文章库</b>攒样本（含 Rubric 打分），<b>写作风格</b>把样本归纳成可注入提示词的写法。
        建议覆盖不同作者、文体、热度层级。
      </p>
    </div>

    <nav class="seg">
      <button :class="{ active: pane === 'articles' }" @click="switchPane('articles')">
        文章库<span class="count">{{ items.length }}</span>
      </button>
      <button :class="{ active: pane === 'styles' }" @click="switchPane('styles')">
        写作风格<span class="count">{{ styleGroups.length }}</span>
      </button>
    </nav>

    <template v-if="pane === 'articles'">
      <div class="card">
        <h2>从公众号链接抓取</h2>
        <label>文章链接</label>
        <input v-model="linkInput" placeholder="https://mp.weixin.qq.com/s/..." />
        <p v-if="linkInvalid" class="muted">没识别到公众号链接——目前只支持 mp.weixin.qq.com 的文章。</p>
        <button class="primary" :disabled="ingesting" @click="doIngest">{{ ingesting ? '抓取中…' : '抓取并入库' }}</button>
        <p v-if="fetchErr" class="err">{{ fetchErr }}</p>
        <p v-if="info" class="muted">{{ info }}</p>
        <p class="muted">抓到后自动写入基准库：标题、公众号名、发布日期、摘录。全文只在内存里用于打分，不落库。</p>

        <div v-if="lastIngested" class="card" style="background: var(--bg-soft)">
          <p>刚刚入库：<strong>{{ lastIngested.title }}</strong></p>
          <p class="muted">{{ lastIngested.author || '作者未知' }} · 正文 {{ lastIngested.chars }} 字</p>
          <button @click="undoLast">撤销这次入库</button>
        </div>
      </div>

      <p v-if="err" class="err">{{ err }}</p>
      <p v-if="!items.length" class="muted">基准库还是空的：先粘一篇公众号文章链接抓进来，攒够几篇再划分风格。</p>

      <div v-for="b in items" :key="b.id" class="card">
        <h2>
          {{ b.title }}
          <span class="pill">{{ b.platform }}</span>
          <span v-if="b.style_name" class="pill">{{ b.style_name }}</span>
          <span v-else class="pill">未归类</span>
        </h2>
        <p class="muted">{{ b.author }} · {{ b.published_at }} · 标签 {{ b.tags || '无' }}</p>
        <p class="muted">{{ b.rubric ? 'Rubric：' + b.rubric : '未打分' }}</p>
        <button @click="score(b)">AI 打分</button>
        <button style="color: var(--warn)" @click="del(b.id)">删除</button>
      </div>
    </template>

    <template v-else>
      <div class="card">
        <h2>写作风格（自动划分）</h2>
        <p class="muted">
          按文体、语气、结构骨架、开头方式、句式节奏，把库里文章归到同一类写法下。能归入已有风格就归入，
          明显不同族才新建——所以库越大，风格分得越准。写初稿时只注入 1 个风格档案（质量分最高的那个）。
        </p>
        <p v-if="!items.length" class="muted">还没有文章。先去「文章库」抓几篇，再回来划分。</p>
        <button class="primary" :disabled="clustering || !pendingCount" @click="runCluster">
          {{ clustering ? '划分中…' : `自动划分风格（待划分 ${pendingCount} 篇）` }}
        </button>
        <p v-if="clusterMsg" class="muted">{{ clusterMsg }}</p>
        <p v-if="clusterErr" class="err">{{ clusterErr }}</p>

        <div v-for="g in styleGroups" :key="g.id" class="card" style="background: var(--bg-soft)">
          <h2>{{ g.name }} <span class="pill">{{ g.members.length }} 篇</span></h2>
          <p v-if="g.summary" class="muted">{{ g.summary }}</p>
          <p class="muted">
            质量分 {{ g.quality ? g.quality.toFixed(1) : '—' }}（该风格下 Rubric 总分均值，写作时择优用）
          </p>
          <p class="muted">篇目：{{ g.members.map(m => `《${m.title}》`).join('、') }}</p>
          <button style="color: var(--warn)" @click="delStyle(g.id)">删除这个风格（文章保留）</button>
        </div>
        <p v-if="!styleGroups.length && items.length" class="muted">还没有风格档案，点上面的按钮开始划分。</p>
      </div>
    </template>
  </div>
</template>
