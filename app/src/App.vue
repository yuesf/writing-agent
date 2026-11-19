<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getProfile } from './core/db'
import Onboarding from './views/Onboarding.vue'
import ProjectList from './views/ProjectList.vue'
import Benchmark from './views/Benchmark.vue'
import Settings from './views/Settings.vue'
import Pipeline from './views/Pipeline.vue'

const tab = ref<'projects' | 'benchmark' | 'settings'>('projects')
const needOnboarding = ref(true)
const openProjectId = ref<number | null>(null)

onMounted(async () => {
  const p = await getProfile()
  needOnboarding.value = !p
})

async function finishOnboarding() {
  needOnboarding.value = false
}

async function onSettingsSaved() {
  needOnboarding.value = !(await getProfile())
}
</script>

<template>
  <Onboarding v-if="needOnboarding" @done="finishOnboarding" />
  <template v-else>
    <Pipeline v-if="openProjectId" :project-id="openProjectId" @back="openProjectId = null" />
    <div v-else class="page">
      <ProjectList v-show="tab === 'projects'" @open="openProjectId = $event" />
      <Benchmark v-show="tab === 'benchmark'" />
      <Settings v-show="tab === 'settings'" @saved="onSettingsSaved" />
      <nav class="tabs">
        <button :class="{ active: tab === 'projects' }" @click="tab = 'projects'">写作</button>
        <button :class="{ active: tab === 'benchmark' }" @click="tab = 'benchmark'">对标</button>
        <button :class="{ active: tab === 'settings' }" @click="tab = 'settings'">设置</button>
      </nav>
    </div>
  </template>
</template>
