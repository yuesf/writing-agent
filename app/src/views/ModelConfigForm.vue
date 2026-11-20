<script setup lang="ts">
// 模型配置表单（ADR-016）：选服务商 → 接口地址自动带出 → 填 Key → 拉取模型列表 → 选模型
// 状态自持，父组件在保存时通过 getValue() 取值，避免双向绑定的响应式陷阱。
import { computed, reactive, ref, watch } from 'vue'
import {
  CUSTOM_PROVIDER_ID, PROVIDERS, loadModels, providerById, providerByUrl
} from '../core/providers'
import type { LlmDraft } from '../core/types'

const props = defineProps<{ initial?: LlmDraft | null }>()

const state = reactive<LlmDraft>({
  provider: 'deepseek',
  base_url: PROVIDERS[0].base_url,
  model: '',
  api_key: ''
})

const models = ref<string[]>([])
const loading = ref(false)
const fetched = ref(false)
const manualMode = ref(false)
const note = ref('')
const err = ref('')

const preset = computed(() => providerById(state.provider))
const isCustom = computed(() => !preset.value)

function hydrate(init?: LlmDraft | null) {
  if (!init) return
  const provider = init.provider || providerByUrl(init.base_url)?.id || (init.base_url ? CUSTOM_PROVIDER_ID : 'deepseek')
  const p = providerById(provider)
  state.provider = provider
  state.base_url = init.base_url || p?.base_url || ''
  state.model = init.model || ''
  state.api_key = init.api_key || ''
  // 不预置候选：已存的型号单独放进来，保证下拉能显示出当前值，其余等接口拉
  models.value = state.model ? [state.model] : []
  note.value = p?.note ?? ''
}

watch(() => props.initial, v => hydrate(v), { immediate: true })

function onProviderChange(e: Event) {
  const id = (e.target as HTMLSelectElement).value
  const p = providerById(id)
  state.provider = id
  state.base_url = p?.base_url ?? ''
  state.model = ''
  models.value = []
  fetched.value = false
  manualMode.value = false
  note.value = p?.note ?? ''
  err.value = ''
}

async function refresh() {
  err.value = ''
  if (!state.base_url.trim()) {
    err.value = '接口地址为空：请先选择服务商'
    return
  }
  if (!state.api_key.trim()) {
    err.value = '先填 API Key，拉取模型列表需要鉴权'
    return
  }
  loading.value = true
  try {
    const r = await loadModels(state.base_url, state.api_key)
    models.value = r.models
    fetched.value = true
    manualMode.value = false
    note.value = r.note
    if (!state.model || !r.models.includes(state.model)) state.model = r.models[0] ?? ''
  } catch (e: any) {
    // 拉取失败就保持空列表，让用户看到真实原因，不用内置清单糊过去
    err.value = `获取模型列表失败：${String(e?.message ?? e)}`
  } finally {
    loading.value = false
  }
}

defineExpose({
  getValue: (): LlmDraft => ({ ...state })
})
</script>

<template>
  <div class="card">
    <h2>模型配置</h2>

    <label>服务商</label>
    <select :value="state.provider" @change="onProviderChange">
      <!-- 老配置里的服务商已下线时，保留一条只读项，避免下拉显示空白 -->
      <option v-if="isCustom" :value="state.provider">自定义（旧配置）</option>
      <option v-for="p in PROVIDERS" :key="p.id" :value="p.id">{{ p.label }}</option>
    </select>

    <template v-if="isCustom">
      <label>接口地址（OpenAI 兼容）</label>
      <input v-model="state.base_url" placeholder="https://your-gateway.com/v1" />
    </template>
    <p v-else class="muted addr">接口地址：{{ state.base_url }}</p>

    <label>API Key *</label>
    <input v-model="state.api_key" type="password" placeholder="只存在你的手机本地" />

    <div class="row">
      <label class="row-label">模型</label>
      <button class="mini" :disabled="loading" @click="refresh">
        {{ loading ? '获取中…' : fetched ? '重新获取' : '获取模型列表' }}
      </button>
    </div>

    <input v-if="manualMode" v-model="state.model" placeholder="手动填写模型名" />
    <select v-else v-model="state.model" :disabled="!models.length">
      <option value="">
        {{ loading ? '获取中…' : models.length ? '请选择模型' : '请先点「获取模型列表」' }}
      </option>
      <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
    </select>
    <p class="muted">
      <button class="link" @click="manualMode = !manualMode">
        {{ manualMode ? '改从列表选择' : '手动填写模型名' }}
      </button>
    </p>

    <p v-if="note" class="muted">{{ note }}</p>
    <p v-if="err" class="err">{{ err }}</p>
    <slot />
  </div>
</template>
