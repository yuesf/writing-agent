<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { createProject, listProjects } from '../core/db'
import type { Project } from '../core/types'

const emit = defineEmits<{ open: [id: number] }>()
const projects = ref<Project[]>([])
const showNew = ref(false)
const form = ref({ title: '', topic_brief: '', requirements: '' })
const err = ref('')

async function reload() {
  projects.value = await listProjects()
}
onMounted(reload)

async function create() {
  err.value = ''
  if (!form.value.title) { err.value = '标题必填'; return }
  const id = await createProject(form.value.title, form.value.topic_brief, form.value.requirements)
  emit('open', id)
}
</script>

<template>
  <div class="page">
    <div class="card">
      <h1>写作项目</h1>
      <p class="muted">每篇文章是一个项目，走流水线：大纲 → 初稿 → 标题/口播。每一步你确认后才进入下一步。</p>
      <button class="primary" @click="showNew = !showNew">{{ showNew ? '收起' : '＋ 新建项目' }}</button>
    </div>
    <div v-if="showNew" class="card">
      <label>标题（选题）*</label>
      <input v-model="form.title" placeholder="如：写作智能体为什么不用开源框架当内核" />
      <label>选题描述（用于素材匹配，写得越具体注入越准）</label>
      <textarea v-model="form.topic_brief" placeholder="说明这篇要讲什么、给谁看、核心观点是什么"></textarea>
      <label>本次写作要求（字数 / 口吻 / 必含点 / 目标平台）</label>
      <textarea v-model="form.requirements" placeholder="如：1800 字左右，口语化，必须提 IP 白名单这个坑，发公众号"></textarea>
      <p class="err">{{ err }}</p>
      <button class="primary" @click="create">创建</button>
    </div>
    <div v-for="pr in projects" :key="pr.id" class="card" @click="emit('open', pr.id)" style="cursor: pointer">
      <h2>{{ pr.title }} <span class="pill">{{ pr.status === 'done' ? '已完成' : '写作中' }}</span></h2>
      <p class="muted">{{ pr.topic_brief.slice(0, 60) }}</p>
    </div>
    <div v-if="!projects.length" class="card"><p class="muted">还没有项目。先去「对标」页录入几篇对标文章，写作质量会明显更好。</p></div>
  </div>
</template>
