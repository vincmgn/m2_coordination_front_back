<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import { FEATURE_LABELS, listCinemas, type Cinema } from '@/api'
import NearbyBar from '@/components/NearbyBar.vue'
import { formatDistance, nearbyParams, type SearchCenter } from '@/geo'

const NearbyMap = defineAsyncComponent(() => import('@/components/NearbyMap.vue'))
const RADIUS_KM = 5
const LIMIT = 6

const center = ref<SearchCenter | null>(null)
const feature = ref('')
const page = ref(1)
const cinemas = ref<Cinema[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
const pages = computed(() => Math.max(1, Math.ceil(total.value / LIMIT)))
let generation = 0

async function load() {
  const id = ++generation
  loading.value = true
  error.value = ''
  try {
    const params = center.value
      ? nearbyParams(center.value, { radiusKm: RADIUS_KM, feature: feature.value, page: page.value, limit: LIMIT })
      : new URLSearchParams({ page: String(page.value), limit: String(LIMIT), ...(feature.value ? { feature: feature.value } : {}) })
    const result = await listCinemas(params)
    if (id !== generation) return
    cinemas.value = result.data
    total.value = result.total
  } catch (e) {
    if (id === generation) error.value = (e as Error).message
  } finally {
    if (id === generation) loading.value = false
  }
}

function around(c: SearchCenter) {
  center.value = c
  page.value = 1
  load()
}

function reset() {
  center.value = null
  page.value = 1
  load()
}

function go(to: number) {
  page.value = to
  load()
}

onMounted(load)
</script>

<template>
  <h1>Cinémas</h1>
  <NearbyBar @center="around" />

  <div class="filters">
    <label>
      Équipement
      <select v-model="feature" @change="go(1)">
        <option value="">Tous</option>
        <option v-for="(text, key) in FEATURE_LABELS" :key="key" :value="key">{{ text }}</option>
      </select>
    </label>
    <button v-if="center" class="link" @click="reset">Revenir à tous les cinémas</button>
  </div>

  <h2 v-if="center">{{ total }} cinéma{{ total > 1 ? 's' : '' }} à moins de {{ RADIUS_KM }} km</h2>
  <h2 v-else>{{ total }} cinéma{{ total > 1 ? 's' : '' }}</h2>
  <p v-if="center" class="muted">
    Autour de {{ center.label }}, du plus proche au plus loin.
    <template v-if="center.accuracyM && center.accuracyM > 1000"> Position approximative (± {{ formatDistance(center.accuracyM / 1000) }}).</template>
  </p>

  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-else-if="loading && !cinemas.length" class="muted">Chargement…</p>
  <p v-else-if="!cinemas.length && center" class="muted">Aucun cinéma à moins de {{ RADIUS_KM }} km. Essayez une autre adresse ou un autre équipement.</p>

  <template v-if="cinemas.length && !error">
    <NearbyMap v-if="center" :center="center" :radius-km="RADIUS_KM" :items="cinemas" />
    <ul class="list">
      <li v-for="c in cinemas" :key="c.slug" class="card">
        <div>
          <h3>{{ c.name }}</h3>
          <p class="muted">{{ c.address }}, {{ c.city }}</p>
          <p class="tags">
            <span v-for="f in c.features" :key="f" class="tag">{{ FEATURE_LABELS[f] ?? f }}</span>
          </p>
        </div>
        <p v-if="c.distanceKm != null" class="distance">À {{ formatDistance(c.distanceKm) }}</p>
      </li>
    </ul>
    <nav v-if="pages > 1" class="pager" aria-label="Pages">
      <button class="btn" :disabled="page <= 1" @click="go(page - 1)">Précédent</button>
      <span class="muted">Page {{ page }} / {{ pages }}</span>
      <button class="btn" :disabled="page >= pages" @click="go(page + 1)">Suivant</button>
    </nav>
  </template>
</template>

<style scoped>
h1 {
  margin-top: 0;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
  margin: 1.25rem 0;
}

.filters select {
  margin-left: 0.5rem;
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
}

.link {
  padding: 0;
  font: inherit;
  color: var(--accent);
  text-decoration: underline;
  background: none;
  border: 0;
  cursor: pointer;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.card {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 1rem;
  padding: 1rem 1.25rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.card h3,
.card p {
  margin: 0 0 0.35rem;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.tag {
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-soft);
  font-size: 0.8rem;
}

.distance {
  flex-shrink: 0;
  padding: 0.25rem 0.7rem;
  border-radius: 999px;
  background: var(--success);
  color: var(--success-text);
  font-weight: 700;
  white-space: nowrap;
}

.pager {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 1rem;
  margin-top: 1.25rem;
}

@media (max-width: 560px) {
  .card {
    flex-direction: column;
  }
}
</style>
