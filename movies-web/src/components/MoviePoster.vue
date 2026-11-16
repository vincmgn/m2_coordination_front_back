<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { posterColor } from '@/posterColor'

const props = defineProps<{ src?: string; title: string; decorative?: boolean }>()

const broken = ref(false)
watch(
  () => props.src,
  () => (broken.value = false),
)

const color = computed(() => posterColor(props.title))
</script>

<template>
  <img v-if="src && !broken" :src="src" :alt="decorative ? '' : `Affiche de ${title}`" loading="lazy" @error="broken = true" />
  <div v-else-if="decorative" class="placeholder" :style="{ background: color }" aria-hidden="true">
    <span>{{ title }}</span>
  </div>
  <div v-else class="placeholder" :style="{ background: color }" role="img" :aria-label="`Pas d'affiche pour ${title}`">
    <span aria-hidden="true">{{ title }}</span>
  </div>
</template>

<style scoped>
img,
.placeholder {
  display: block;
  width: 100%;
  aspect-ratio: 2 / 3;
  border-radius: var(--radius);
  background: var(--surface-2);
  object-fit: cover;
}

.placeholder {
  display: flex;
  align-items: flex-end;
  padding: 12%;
  overflow: hidden;
  container-type: inline-size;
}

.placeholder span {
  font-size: clamp(0.7rem, 17cqi, 3rem);
  font-stretch: 62%;
  font-weight: 900;
  line-height: 0.9;
  text-transform: uppercase;
  color: #0d0d11;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
