<script setup lang="ts">
// Page d'accueil : une seule barre de recherche.
//   barre vide          → liste paginée de tous les films
//   2 caractères ou +   → recherche réactive par titre, genre ou année (cours « recherche réactive ») :
//     1. AVANT L'ENVOI    debounce : la requête ne part qu'après 300 ms sans nouvelle frappe
//     2. PENDANT L'ATTENTE abort : l'appel précédent est annulé (AbortController) à chaque nouvelle saisie
//     3. AVANT L'AFFICHAGE génération : seule la réponse de la recherche actuelle peut modifier l'écran
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { listMovies, searchMovies, type MovieSummary, type Paginated, type SearchItem } from '@/api'
import MovieCard from '@/components/MovieCard.vue'

const LIMIT = 24
const DELAY_MS = 300
const MIN_LENGTH = 2
const MAX_LENGTH = 60

const route = useRoute()
const router = useRouter()
const str = (value: unknown) => (typeof value === 'string' ? value : '')

// --- Recherche réactive --------------------------------------------------------------------------

type State = 'idle' | 'invalid' | 'waiting' | 'loading' | 'success' | 'empty' | 'error'

// Le texte est aussi gardé dans l'URL (?q=…) : partageable, et retrouvé au retour arrière.
const query = ref(str(route.query.q))
const results = ref<SearchItem[]>([])
const displayedQuery = ref('') // texte réellement recherché par l'API (champ query de la réponse)
const state = ref<State>('idle')
const error = ref('')
const searching = computed(() => query.value.trim().length > 0)

let timer: ReturnType<typeof setTimeout> | undefined
let controller: AbortController | undefined
let generation = 0 // numéro de la dernière intention de recherche
let stopped = false

// Appelée à chaque changement du champ (et par « Réessayer ») : invalide l'ancien travail tout de suite,
// puis programme le nouveau. Le numéro augmente même si la saisie devient vide ou trop courte.
function plan(value: string) {
  const id = ++generation
  clearTimeout(timer)
  controller?.abort()
  results.value = []
  displayedQuery.value = ''
  error.value = ''
  const term = value.trim()
  router.replace({ query: term ? { q: term } : {} })
  if (term.length < MIN_LENGTH) {
    state.value = 'idle'
    return
  }
  if (term.length > MAX_LENGTH) {
    state.value = 'invalid'
    return
  }
  state.value = 'waiting'
  timer = setTimeout(() => search(term, id), DELAY_MS)
}

async function search(term: string, id: number) {
  if (stopped || id !== generation) return
  const ownController = new AbortController()
  controller = ownController
  state.value = 'loading'
  try {
    const data = await searchMovies(term, ownController.signal) // lève une erreur si la réponse n'est pas ok
    // Contrôle après la dernière attente, avant de toucher à l'écran.
    if (stopped || id !== generation) return
    results.value = data.items
    displayedQuery.value = data.query
    state.value = data.items.length ? 'success' : 'empty'
  } catch (e) {
    // Ancienne recherche, page quittée ou annulation volontaire : rien à afficher.
    if (stopped || id !== generation || (e as Error).name === 'AbortError') return
    error.value = `Recherche impossible. ${(e as Error).message}`
    state.value = 'error'
  }
}

// flush 'sync' : plan est appelé à chaque modification, sans attendre le rendu suivant.
watch(query, plan, { flush: 'sync' })
if (query.value) plan(query.value) // arrivée avec ?q=… dans l'URL
// L'URL change sans passer par le champ (clic sur le logo, retour arrière) : on resynchronise le champ.
watch(
  () => route.query.q,
  (q) => {
    if (str(q) !== query.value.trim()) query.value = str(q)
  },
)

// Quitter la page : invalider, arrêter le minuteur et abandonner la requête en cours.
onUnmounted(() => {
  stopped = true
  ++generation
  clearTimeout(timer)
  controller?.abort()
})

const statusText = computed(() => {
  switch (state.value) {
    case 'idle':
      return `Saisissez au moins ${MIN_LENGTH} caractères.`
    case 'invalid':
      return `${MAX_LENGTH} caractères maximum.`
    case 'waiting':
      return 'Pause de saisie…'
    case 'loading':
      return 'Recherche en cours…'
    case 'success': {
      const n = results.value.length
      const s = n > 1 ? 's' : ''
      return `${n} résultat${s} affiché${s} pour « ${displayedQuery.value} »${n === 20 ? ' (20 premiers)' : ''}.`
    }
    case 'empty':
      return `Aucun film trouvé pour « ${displayedQuery.value} ».`
    case 'error':
      return error.value
  }
  return ''
})

const toSummary = ({ id, ...rest }: SearchItem): MovieSummary => ({ _id: id, ...rest })

// --- Liste paginée (barre vide) ------------------------------------------------------------------

const page = computed(() => Number(route.query.page) || 1)
const list = ref<Paginated<MovieSummary> | null>(null)
const listLoading = ref(false)
const listError = ref<string | null>(null)
let lastListRequest = 0

const setPage = (p: number) => router.replace({ query: p > 1 ? { page: p } : {} })

watch(
  [page, searching],
  async () => {
    if (searching.value || route.name !== 'movies') return
    const requestId = ++lastListRequest
    listLoading.value = true
    listError.value = null
    try {
      const data = await listMovies({ page: page.value, limit: LIMIT })
      if (requestId === lastListRequest) list.value = data
    } catch (e) {
      if (requestId === lastListRequest) listError.value = (e as Error).message
    } finally {
      if (requestId === lastListRequest) listLoading.value = false
    }
  },
  { immediate: true },
)
</script>

<template>
  <section class="searchbar">
    <label for="search" class="label">Rechercher par titre, genre ou année</label>
    <div class="row">
      <input
        id="search"
        v-model="query"
        type="search"
        :maxlength="MAX_LENGTH"
        autocomplete="off"
        placeholder="ex. matrix, drama, 1999…"
        aria-describedby="search-status"
      />
      <button v-if="query" type="button" class="btn" @click="query = ''">Effacer</button>
    </div>
  </section>

  <!-- Recherche réactive -->
  <template v-if="searching">
    <div class="status-row">
      <p id="search-status" class="status" :class="state" role="status" aria-live="polite">{{ statusText }}</p>
      <!-- Réessayer passe par la même planification que la saisie. -->
      <button v-if="state === 'error'" type="button" class="btn" @click="plan(query)">Réessayer</button>
    </div>
    <div class="grid" :aria-busy="state === 'loading'">
      <MovieCard v-for="item in results" :key="item.id" :movie="toSummary(item)" />
    </div>
  </template>

  <!-- Liste paginée -->
  <template v-else>
    <p v-if="listError" class="error">Impossible de charger les films : {{ listError }}</p>

    <template v-else-if="list">
      <p class="status muted">
        {{ list.total.toLocaleString('fr-FR') }} film{{ list.total > 1 ? 's' : '' }}
        <span v-if="listLoading"> · chargement…</span>
      </p>

      <div class="grid" :class="{ loading: listLoading }">
        <MovieCard v-for="movie in list.data" :key="movie._id" :movie="movie" />
      </div>

      <nav v-if="list.totalPages > 1" class="pagination" aria-label="Pagination">
        <button class="btn" :disabled="list.page <= 1" @click="setPage(list.page - 1)">← Précédent</button>
        <span class="muted">Page {{ list.page }} / {{ list.totalPages.toLocaleString('fr-FR') }}</span>
        <button class="btn" :disabled="list.page >= list.totalPages" @click="setPage(list.page + 1)">Suivant →</button>
      </nav>
    </template>

    <p v-else class="muted">Chargement…</p>
  </template>
</template>

<style scoped>
.searchbar {
  margin-bottom: 0.5rem;
}

.label {
  display: block;
  margin-bottom: 0.35rem;
  font-size: 0.85rem;
  color: var(--muted);
}

.row {
  display: flex;
  gap: 0.5rem;
}

.row input {
  font-size: 1.05rem;
  padding: 0.7rem 1rem;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  min-height: 2.75rem;
  margin-bottom: 0.5rem;
}

.status {
  margin: 0.5rem 0 1rem;
  font-size: 0.9rem;
  color: var(--muted);
}

.status-row .status {
  margin: 0;
}

.status.error {
  color: var(--danger);
}

.status.success {
  color: var(--text);
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

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  margin-top: 2rem;
}

@media (max-width: 640px) {
  .grid {
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  }
}
</style>
