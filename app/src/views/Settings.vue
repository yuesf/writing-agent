<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  addAsset, getLlmConfig, getProfile, listAssets, listProfileHistory, listProjects,
  listProposals, removeRow, resolveProposal, rollbackProfile, saveLlmConfig, saveProfile
} from '../core/db'
import { extractProfile } from '../core/agent/profileLearn'
import { PROFILE_FIELD_LABEL } from '../core/types'
import type { Asset, LlmDraft, ProfileHistory, ProfileProposal, UserProfile } from '../core/types'
import ModelConfigForm from './ModelConfigForm.vue'

const emit = defineEmits<{ saved: [] }>()
const err = ref('')
const info = ref('')

// 用户档案（身份层，ADR-014）
const p = ref<UserProfile | null>(null)
const profileForm = ref({ name: '', profession: '', background: '', platform: '', audience: '' })

// 档案演化（ADR-015）
const proposals = ref<ProfileProposal[]>([])
const history = ref<ProfileHistory[]>([])
const extracting = ref(false)

// LLM 配置：由子组件持有表单状态，这里只存初值与结果
const llmInitial = ref<LlmDraft | null>(null)
const llmForm = ref<InstanceType<typeof ModelConfigForm> | null>(null)

// 个人元素库（ADR-013 第六类资产）
const element = ref('')
const assets = ref<Asset[]>([])

onMounted(async () => {
  p.value = await getProfile()
  if (p.value) Object.assign(profileForm.value, p.value)
  const c = await getLlmConfig()
  if (c) llmInitial.value = { provider: c.provider, base_url: c.base_url, model: c.model, api_key: c.api_key }
  assets.value = (await listAssets({ type: 'personal' })).reverse()
  await loadEvolution()
})

async function loadEvolution() {
  proposals.value = await listProposals('pending')
  history.value = await listProfileHistory()
}

async function saveProfileForm() {
  err.value = ''
  if (!profileForm.value.name) { err.value = '称呼必填'; return }
  await saveProfile(profileForm.value)
  p.value = await getProfile()
  info.value = '身份信息已更新'
  emit('saved')
}

async function saveLlmForm() {
  err.value = ''
  info.value = ''
  const v = llmForm.value?.getValue()
  if (!v?.base_url || !v.model || !v.api_key) { err.value = '接口地址、模型、API Key 三项都要有'; return }
  try {
    await saveLlmConfig(v)
    // 不回写 llmInitial：子组件状态本身就是最新的，回写会触发重新 hydrate 并丢失已拉取的模型列表
    info.value = '模型配置已更新'
  } catch (e: any) {
    err.value = String(e?.message ?? e)
  }
}

async function addElement() {
  err.value = ''
  const c = element.value.trim()
  if (!c) return
  await addAsset({ type: 'personal', source: 'personal', content: c, tags: '', quality: 0, sensitive: 0 })
  element.value = ''
  assets.value = (await listAssets({ type: 'personal' })).reverse()
}

async function removeAsset(id: number) {
  await removeRow('asset', id)
  assets.value = (await listAssets({ type: 'personal' })).reverse()
}

// ---------- 档案演化（ADR-015） ----------
async function accept(id: number) {
  err.value = ''
  try {
    await resolveProposal(id, true)
    p.value = await getProfile()
    if (p.value) Object.assign(profileForm.value, p.value)
    await loadEvolution()
    info.value = '已采纳并合并进档案（可回滚）'
  } catch (e: any) {
    err.value = String(e?.message ?? e)
  }
}

async function reject(id: number) {
  await resolveProposal(id, false)
  await loadEvolution()
}

// 手动提炼：取最近一个项目作为信号源（不依赖确认动作）
async function extractNow() {
  err.value = ''
  info.value = ''
  extracting.value = true
  try {
    const projects = await listProjects()
    if (!projects.length) { err.value = '还没有写作记录，先写一篇再提炼'; return }
    const r = await extractProfile(projects[0].id, 'manual')
    await loadEvolution()
    info.value = r.created > 0
      ? `提炼出 ${r.created} 条建议，逐条确认后才会写入档案`
      : (r.reason || '没有发现新的档案信息')
  } catch (e: any) {
    err.value = String(e?.message ?? e)
  } finally {
    extracting.value = false
  }
}

async function undo() {
  err.value = ''
  const ok = await rollbackProfile()
  if (!ok) { err.value = '没有可回滚的历史版本'; return }
  p.value = await getProfile()
  if (p.value) Object.assign(profileForm.value, p.value)
  await loadEvolution()
  info.value = '已回滚到上一个版本'
}
</script>

<template>
  <div class="page">
    <div class="card">
      <h2>身份信息</h2>
      <label>称呼 *</label><input v-model="profileForm.name" />
      <label>职业 / 领域</label><input v-model="profileForm.profession" />
      <label>身份背景与经历简介</label><textarea v-model="profileForm.background"></textarea>
      <label>写作平台与账号定位</label><input v-model="profileForm.platform" />
      <label>目标读者</label><input v-model="profileForm.audience" />
      <button class="primary" @click="saveProfileForm">保存档案</button>
    </div>

    <div class="card">
      <h2>档案演化 <span class="pill">{{ proposals.length }} 条待确认</span></h2>
      <p class="muted">系统会从你的调整指令、写作要求和确认动作里，提炼"你是谁"的候选信息。<b>只有你采纳后才会写入档案</b>；一次性要求（字数、某段改法）不会被当成画像。</p>

      <div v-for="it in proposals" :key="it.id" style="border-top: 1px dashed var(--line); padding-top: 8px; margin-top: 8px">
        <p><b>{{ PROFILE_FIELD_LABEL[it.field] || it.field }}</b>
          <span class="pill">{{ Math.round((it.confidence || 0) * 100) }}%</span></p>
        <p class="muted">现值：{{ it.current_value || '（空）' }}</p>
        <p>建议：{{ it.proposed_value }}</p>
        <p class="muted" v-if="it.reason">依据：{{ it.reason }}</p>
        <button class="primary" @click="accept(it.id)">采纳</button>
        <button @click="reject(it.id)">忽略</button>
      </div>
      <p v-if="!proposals.length" class="muted">暂无待确认建议。确认阶段或点下面的按钮可触发提炼。</p>

      <button :disabled="extracting" @click="extractNow">
        {{ extracting ? '提炼中…' : '从最近写作记录提炼' }}
      </button>
      <button v-if="history.length" @click="undo">回滚上一次档案变更（{{ history.length }} 个版本）</button>
    </div>

    <ModelConfigForm ref="llmForm" :initial="llmInitial">
      <button class="primary" @click="saveLlmForm">保存配置</button>
    </ModelConfigForm>

    <div class="card">
      <h2>个人元素库</h2>
      <p class="muted">你的独特素材：经历故事、观点立场、口头禅、常用案例、表达禁忌。写作时自动融入，让文章有你这个人。</p>
      <input v-model="element" placeholder="如：2026 年跑完采石矶半马 2:14，后程掉速的教训" />
      <button class="primary" @click="addElement">添加元素</button>
      <div v-for="a in assets" :key="a.id" style="margin-top: 6px">
        <p>{{ a.content }} <button style="color: var(--warn)" @click="removeAsset(a.id)">删</button></p>
      </div>
    </div>

    <div class="card">
      <h2>资产库</h2>
      <p class="muted">素材资产（样本/句式/结构/事实/规则）通过对标文章分析和你导入的资料自动生成；规则库由反馈蒸馏产生（v2）。敏感资产不进提示词。</p>
    </div>
    <p class="err card">{{ err }}</p>
    <p class="muted card">{{ info }}</p>
  </div>
</template>
