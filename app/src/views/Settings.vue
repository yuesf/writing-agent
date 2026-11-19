<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { addAsset, getLlmConfig, getProfile, listAssets, removeRow, saveLlmConfig, saveProfile } from '../core/db'
import type { Asset, LlmConfig, UserProfile } from '../core/types'

const emit = defineEmits<{ saved: [] }>()
const err = ref('')
const info = ref('')

// 用户档案（身份层，ADR-014）
const p = ref<UserProfile | null>(null)
const profileForm = ref({ name: '', profession: '', background: '', platform: '', audience: '' })

// LLM 配置
const llm = ref<LlmConfig | null>(null)
const llmForm = ref({ base_url: '', model: '', api_key: '' })

// 个人元素库（ADR-013 第六类资产）
const element = ref('')
const assets = ref<Asset[]>([])

onMounted(async () => {
  p.value = await getProfile()
  if (p.value) Object.assign(profileForm.value, p.value)
  llm.value = await getLlmConfig()
  if (llm.value) Object.assign(llmForm.value, llm.value)
  assets.value = (await listAssets({ type: 'personal' })).reverse()
})

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
  if (!llmForm.value.base_url || !llmForm.value.model || !llmForm.value.api_key) { err.value = '三项都要填'; return }
  await saveLlmConfig(llmForm.value)
  info.value = '模型配置已更新'
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
      <h2>模型配置</h2>
      <label>接口地址（OpenAI 兼容）</label><input v-model="llmForm.base_url" />
      <label>模型</label><input v-model="llmForm.model" />
      <label>API Key（只存本地）</label><input v-model="llmForm.api_key" type="password" />
      <button class="primary" @click="saveLlmForm">保存配置</button>
    </div>

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
