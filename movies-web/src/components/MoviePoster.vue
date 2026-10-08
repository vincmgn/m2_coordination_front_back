<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{ src?: string; title: string }>()

// Beaucoup d'affiches du dataset ne répondent plus : on affiche alors un emplacement neutre.
const broken = ref(false)
watch(
  () => props.src,
  () => (broken.value = false),
)
</script>

<template>
  <img v-if="src && !broken" :src="src" :alt="`Affiche de ${title}`" loading="lazy" @error="broken = true" />
  <div v-else class="placeholder" role="img" :aria-label="`Pas d'affiche pour ${title}`">🎞️</div>
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
  display: grid;
  place-items: center;
  font-size: 2.5rem;
}
</style>
