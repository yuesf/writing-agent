<script setup lang="ts">
import { reactive, ref } from 'vue'
import { getLlmConfig, getProfile, saveLlmConfig, saveProfile } from '../core/db'
import type { LlmDraft } from '../core/types'
import ModelConfigForm from './ModelConfigForm.vue'

const emit = defineEmits<{ done: [] }>()
const err = ref('')
const saving = ref(false)

const p = reactive({ name: '', profession: '', background: '', platform: '', audience: '' })

// 模型配置由子组件持有，这里只给初值、保存时取值
const form = ref<InstanceType<typeof ModelConfigForm> | null>(null)
const llmInitial = ref<LlmDraft | null>(null)

// 回填已有配置（从设置页删除档案后可能重新进入）
getProfile().then(v => { if (v) Object.assign(p, { name: v.name, profession: v.profession, background: v.background, platform: v.platform, audience: v.audience }) })
getLlmConfig().then(v => {
  if (v) llmInitial.value = { provider: v.provider, base_url: v.base_url, model: v.model, api_key: v.api_key }
})

async function save() {
  err.value = ''
  const llm = form.value?.getValue()
  if (!p.name) { err.value = '称呼为必填'; return }
  if (!llm?.api_key) { err.value = 'API Key 为必填'; return }
  if (!llm.model) { err.value = '请先获取模型列表并选择一个模型'; return }
  saving.value = true
  try {
    await saveProfile(p)
    await saveLlmConfig(llm)
    emit('done')
  } catch (e: any) {
    err.value = String(e?.message ?? e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="card">
      <h1>欢迎 · 三步开始</h1>
      <p class="muted">第 1 步填写你的身份信息（写入"我是谁"）；第 2 步选服务商并选模型；之后到「对标」页录入 3~5 篇对标文章，就能开始写作。所有数据只存在你的手机里。</p>
    </div>
    <div class="card">
      <h2>你的身份信息</h2>
      <label>称呼 *</label><input v-model="p.name" placeholder="如：小飞哥" />
      <label>职业 / 领域</label><input v-model="p.profession" placeholder="如：企业管理软件 / 零售电商" />
      <label>身份背景与经历简介</label>
      <textarea v-model="p.background" placeholder="写作者的独特背景：经历、专长、可引用的真实故事"></textarea>
      <label>写作平台与账号定位</label><input v-model="p.platform" placeholder="如：公众号「XX」，写 AI 落地实践" />
      <label>目标读者</label><input v-model="p.audience" placeholder="如：关注 AI 转型的业务负责人" />
    </div>

    <ModelConfigForm ref="form" :initial="llmInitial" />

    <div class="card">
      <p class="err">{{ err }}</p>
      <button class="primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '完成，进入写作' }}</button>
    </div>
  </div>
</template>
