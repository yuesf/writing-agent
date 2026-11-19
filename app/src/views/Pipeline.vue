<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getProject, getStages } from '../core/db'
import { confirmStage, generateStage, reviseStage } from '../core/agent/machine'
import { STAGES } from '../core/agent/stages'
import { exportHandoff } from '../core/export/handoff'
import type { Project, StageId, StageState } from '../core/types'

const props = defineProps<{ projectId: number }>()
const emit = defineEmits<{ back: [] }>()

const project = ref<Project | null>(null)
const stages = ref<StageState[]>([])
const streaming = ref<StageId | null>(null)
const streamText = ref('')
const directives = ref<Record<string, string>>({})
const err = ref('')
const exported = ref(false)

const confirmedCount = computed(() => stages.value.filter(s => s.status === 'confirmed').length)
const allConfirmed = computed(() => confirmedCount.value === STAGES.length)

onMounted(load)

async function load() {
  project.value = await getProject(props.projectId)
  stages.value = await getStages(props.projectId)
}

function stageOf(id: StageId): StageState | undefined {
  return stages.value.find(s => s.stage === id)
}

function locked(id: StageId): boolean {
  // 人工门禁：初稿需先确认大纲（ADR-004）
  return id === 'draft' && stageOf('outline')?.status !== 'confirmed'
}

async function gen(id: StageId) {
  err.value = ''
  streaming.value = id
  streamText.value = ''
  try {
    await generateStage(props.projectId, id, d => { streamText.value += d })
    await load()
  } catch (e: any) {
    err.value = String(e?.message ?? e)
  } finally {
    streaming.value = null
  }
}

async function revise(id: StageId) {
  const d = (directives.value[id] ?? '').trim()
  if (!d) { err.value = '请先输入调整指令'; return }
  err.value = ''
  streaming.value = id
  streamText.value = ''
  try {
    await reviseStage(props.projectId, id, d, t => { streamText.value += t })
    directives.value[id] = ''
    await load()
  } catch (e: any) {
    err.value = String(e?.message ?? e)
  } finally {
    streaming.value = null
  }
}

async function confirm(id: StageId) {
  err.value = ''
  try {
    await confirmStage(props.projectId, id)
    await load()
  } catch (e: any) {
    err.value = String(e?.message ?? e)
  }
}

async function download() {
  if (!project.value) return
  await exportHandoff(project.value, stages.value)
  exported.value = true
}
</script>

<template>
  <div class="page">
    <div class="card">
      <button @click="emit('back')">← 返回</button>
      <h1 style="margin-top: 8px">{{ project?.title }}</h1>
      <p class="muted">选题：{{ project?.topic_brief }}</p>
      <p class="muted">要求：{{ project?.requirements || '未填写' }}</p>
      <p><span class="pill">{{ confirmedCount }}/3 已确认</span></p>
    </div>

    <div v-for="def in STAGES" :key="def.id" class="card">
      <h2>{{ def.label }}
        <span class="pill">{{
          stageOf(def.id)?.status === 'confirmed' ? '已确认'
          : stageOf(def.id)?.status === 'draft' ? '待你确认'
          : stageOf(def.id)?.status === 'generating' ? '生成中'
          : '未生成'
        }}</span>
      </h2>

      <div v-if="streaming === def.id" class="draft">{{ streamText || '连接模型中…' }}</div>
      <div v-else-if="stageOf(def.id)?.draft" class="draft">{{ stageOf(def.id)?.draft }}</div>

      <div style="margin-top: 8px">
        <button class="primary"
          :disabled="locked(def.id) || streaming !== null"
          @click="gen(def.id)">
          {{ stageOf(def.id)?.draft ? '重新生成' : '生成草案' }}
        </button>
        <button v-if="stageOf(def.id)?.status === 'draft'" @click="confirm(def.id)">确认，进入下一步</button>
        <button v-if="stageOf(def.id)?.status === 'confirmed'" @click="confirm(def.id)" disabled>已确认</button>
      </div>

      <div style="margin-top: 8px">
        <input v-model="directives[def.id]" placeholder="调整指令，如：这段再口语化一点" />
        <button :disabled="streaming !== null || !stageOf(def.id)?.draft" @click="revise(def.id)">按指令调整</button>
      </div>
      <p v-if="locked(def.id)" class="muted">人工门禁：先确认大纲，才能生成初稿。</p>
    </div>

    <div class="card">
      <h2>定稿导出</h2>
      <p class="muted">导出 Markdown 交接包（对接公众号 skill：build_article → 预览 → 写草稿箱）。三阶段全部确认后可用。</p>
      <button class="primary" :disabled="!allConfirmed" @click="download">导出交接包 (.md)</button>
      <p v-if="exported" class="muted">已导出。把它和图片素材放到电脑上，交给 wechat-article-writer 执行。</p>
    </div>
    <p class="err card">{{ err }}</p>
  </div>
</template>
