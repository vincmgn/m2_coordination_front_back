<script setup lang="ts">
import { computed, ref, watch } from 'vue'

// decorative : le titre est déjà écrit à côté (carte, liste) ; l'affiche est alors ignorée par les lecteurs d'écran
// pour ne pas annoncer le titre deux fois.
const props = defineProps<{ src?: string; title: string; decorative?: boolean }>()

// Beaucoup d'affiches du dataset ne répondent plus : on affiche alors un emplacement neutre.
const broken = ref(false)
watch(
  () => props.src,
  () => (broken.value = false),
)

// Couleur stable par titre : la même affiche de remplacement d'une page à l'autre.
const COLORS = ['#ffb547', '#7ce0c3', '#ff7a9a', '#b7a6ff', '#f3f1ec', '#8fc9ff']
const color = computed(() => COLORS[[...props.title].reduce((sum, c) => sum + c.charCodeAt(0), 0) % COLORS.length])
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
