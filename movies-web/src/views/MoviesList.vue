<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router'
import { listGenres, listMovies, type MovieSummary, type Paginated } from '@/api'
import MovieCard from '@/components/MovieCard.vue'

const LIMIT = 24

const route = useRoute()
const router = useRouter()

// Les filtres vivent dans l'URL (?title=…&page=…) : partageables, et conservés au retour arrière.
const str = (value: unknown) => (typeof value === 'string' ? value : '')
const filters = computed(() => ({
  page: Number(route.query.page) || 1,
  title: str(route.query.title),
  year: str(route.query.year),
  genre: str(route.query.genre),
}))
const hasFilters = computed(() => Boolean(filters.value.title || filters.value.year || filters.value.genre))

function setFilters(changes: Partial<Record<'page' | 'title' | 'year' | 'genre', string | number>>) {
  // Changer un filtre ramène à la page 1 ; seul le changement de page la conserve.
  const query: LocationQueryRaw = { ...route.query, page: undefined, ...changes }
  for (const key of Object.keys(query)) {
    if (query[key] === '' || query[key] === undefined || (key === 'page' && query[key] === 1)) delete query[key]
  }
  router.replace({ query })
}

// Champ titre : on attend 300 ms après la dernière frappe avant d'interroger l'API.
const titleInput = ref(filters.value.title)
let debounce: ReturnType<typeof setTimeout> | undefined
watch(titleInput, (value) => {
  clearTimeout(debounce)
  debounce = setTimeout(() => setFilters({ title: value.trim() }), 300)
})
watch(
  () => filters.value.title,
  (title) => {
    if (title !== titleInput.value.trim()) titleInput.value = title
  },
)

const genres = ref<string[]>([])
onMounted(async () => {
  genres.value = await listGenres().catch(() => [])
})

const result = ref<Paginated<MovieSummary> | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
let lastRequest = 0

watch(
  () => JSON.stringify(filters.value),
  async () => {
    if (route.name !== 'movies') return
    const requestId = ++lastRequest
    const { page, title, year, genre } = filters.value
    loading.value = true
    error.value = null
    try {
      const data = await listMovies({ page, limit: LIMIT, title, genre, year: year ? Number(year) : undefined })
      // Ignore une réponse arrivée après une requête plus récente (frappe rapide).
      if (requestId === lastRequest) result.value = data
    } catch (e) {
      if (requestId === lastRequest) error.value = (e as Error).message
    } finally {
      if (requestId === lastRequest) loading.value = false
    }
  },
  { immediate: true },
)
</script>

<template>
  <section class="filters" aria-label="Filtres">
    <label class="field field-title">
      <span>Titre</span>
      <input v-model="titleInput" type="search" placeholder="ex. star wars" />
    </label>
    <label class="field">
      <span>Année</span>
      <input
        :value="filters.year"
        type="number"
        min="1880"
        max="2100"
        placeholder="ex. 1999"
        @change="setFilters({ year: ($event.target as HTMLInputElement).value })"
      />
    </label>
    <label class="field">
      <span>Genre</span>
      <select :value="filters.genre" @change="setFilters({ genre: ($event.target as HTMLSelectElement).value })">
        <option value="">Tous</option>
        <option v-for="genre in genres" :key="genre" :value="genre">{{ genre }}</option>
      </select>
    </label>
    <button v-if="hasFilters" class="btn reset" @click="router.replace({ query: {} })">Réinitialiser</button>
  </section>

  <p v-if="error" class="error">Impossible de charger les films : {{ error }}</p>

  <template v-else-if="result">
    <p class="count muted">
      {{ result.total.toLocaleString('fr-FR') }} film{{ result.total > 1 ? 's' : '' }}
      <span v-if="loading"> · chargement…</span>
    </p>

    <p v-if="result.data.length === 0" class="empty muted">Aucun film ne correspond à ces filtres.</p>

    <div class="grid" :class="{ loading }">
      <MovieCard v-for="movie in result.data" :key="movie._id" :movie="movie" />
    </div>

    <nav v-if="result.totalPages > 1" class="pagination" aria-label="Pagination">
      <button class="btn" :disabled="result.page <= 1" @click="setFilters({ page: result.page - 1 })">← Précédent</button>
      <span class="muted">Page {{ result.page }} / {{ result.totalPages.toLocaleString('fr-FR') }}</span>
      <button class="btn" :disabled="result.page >= result.totalPages" @click="setFilters({ page: result.page + 1 })">
        Suivant →
      </button>
    </nav>
  </template>

  <p v-else class="muted">Chargement…</p>
</template>

<style scoped>
.filters {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr auto;
  align-items: end;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.85rem;
  color: var(--muted);
}

.count {
  margin: 0 0 1rem;
  font-size: 0.9rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 1rem;
  transition: opacity 0.15s;
}

.grid.loading {
  opacity: 0.5;
}

.empty {
  padding: 3rem 0;
  text-align: center;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  margin-top: 2rem;
}

@media (max-width: 640px) {
  .filters {
    grid-template-columns: 1fr 1fr;
  }

  .field-title,
  .reset {
    grid-column: 1 / -1;
  }

  .grid {
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  }
}
</style>
