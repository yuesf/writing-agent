<script setup lang="ts">
import { reactive, ref } from 'vue'
import { getLlmConfig, getProfile, saveLlmConfig, saveProfile } from '../core/db'

const emit = defineEmits<{ done: [] }>()
const err = ref('')
const saving = ref(false)

const p = reactive({ name: '', profession: '', background: '', platform: '', audience: '' })
const llm = reactive({ base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', api_key: '' })

// 回填已有配置（从设置页删除档案后可能重新进入）
getProfile().then(v => { if (v) Object.assign(p, { name: v.name, profession: v.profession, background: v.background, platform: v.platform, audience: v.audience }) })
getLlmConfig().then(v => { if (v) Object.assign(llm, { base_url: v.base_url, model: v.model, api_key: v.api_key }) })

async function save() {
  err.value = ''
  if (!p.name || !llm.api_key) { err.value = '称呼与 API Key 为必填'; return }
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
      <p class="muted">第 1 步填写你的身份信息（写入"我是谁"）；第 2 步配置模型；之后到「对标」页录入 3~5 篇对标文章，就能开始写作。所有数据只存在你的手机里。</p>
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
    <div class="card">
      <h2>模型配置（OpenAI 兼容）</h2>
      <label>接口地址</label><input v-model="llm.base_url" />
      <label>模型</label><input v-model="llm.model" />
      <label>API Key *</label><input v-model="llm.api_key" type="password" placeholder="只存你手机本地，随提示词发送给该服务商" />
    </div>
    <div class="card">
      <p class="err">{{ err }}</p>
      <button class="primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '完成，进入写作' }}</button>
    </div>
  </div>
</template>
