<script setup lang="ts">
import { ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { deleteMovie, getMovie, type Movie } from '@/api'
import MoviePoster from '@/components/MoviePoster.vue'
import ScreeningPicker from '@/components/ScreeningPicker.vue'

const props = defineProps<{ id: string }>()
const router = useRouter()

const movie = ref<Movie | null>(null)
const error = ref<string | null>(null)
const deleting = ref(false)

watch(
  () => props.id,
  async (id) => {
    movie.value = null
    error.value = null
    try {
      movie.value = await getMovie(id)
    } catch (e) {
      error.value = (e as Error).message
    }
  },
  { immediate: true },
)

async function remove() {
  if (!movie.value || !confirm(`Supprimer « ${movie.value.title} » ?`)) return
  deleting.value = true
  try {
    await deleteMovie(props.id)
    router.push('/')
  } catch (e) {
    error.value = (e as Error).message
    deleting.value = false
  }
}

const list = (values?: string[]) => values?.filter(Boolean).join(', ')
</script>

<template>
  <button class="btn back" @click="router.back()">← Retour</button>

  <p v-if="error" class="error">{{ error }}</p>
  <p v-else-if="!movie" class="muted">Chargement…</p>

  <article v-else class="detail">
    <MoviePoster :src="movie.poster" :title="movie.title" class="poster" />

    <div class="content">
      <h1>{{ movie.title }}</h1>
      <p class="meta muted">
        <span v-if="movie.year">{{ movie.year }}</span>
        <span v-if="movie.runtime">{{ movie.runtime }} min</span>
        <span v-if="movie.rated">{{ movie.rated }}</span>
        <span v-if="movie.imdb?.rating" class="rating">
          ★ {{ movie.imdb.rating }}<small v-if="movie.imdb.votes"> ({{ movie.imdb.votes.toLocaleString('fr-FR') }} votes)</small>
        </span>
      </p>

      <ul v-if="movie.genres?.length" class="tags">
        <li v-for="genre in movie.genres" :key="genre">{{ genre }}</li>
      </ul>

      <p class="plot">{{ movie.fullplot ?? movie.plot ?? 'Pas de résumé.' }}</p>

      <dl>
        <template v-if="movie.directors?.length">
          <dt>Réalisation</dt>
          <dd>{{ list(movie.directors) }}</dd>
        </template>
        <template v-if="movie.cast?.length">
          <dt>Avec</dt>
          <dd>{{ list(movie.cast) }}</dd>
        </template>
        <template v-if="movie.countries?.length">
          <dt>Pays</dt>
          <dd>{{ list(movie.countries) }}</dd>
        </template>
        <template v-if="movie.released">
          <dt>Sortie</dt>
          <dd>{{ new Date(movie.released).toLocaleDateString('fr-FR', { dateStyle: 'long' }) }}</dd>
        </template>
        <template v-if="movie.awards?.text">
          <dt>Récompenses</dt>
          <dd>{{ movie.awards.text }}</dd>
        </template>
      </dl>

      <div class="actions">
        <RouterLink :to="`/movies/${movie._id}/edit`" class="btn">Modifier</RouterLink>
        <button class="btn btn-danger" :disabled="deleting" @click="remove">
          {{ deleting ? 'Suppression…' : 'Supprimer' }}
        </button>
      </div>

      <ScreeningPicker :movie-id="movie._id" />
    </div>
  </article>
</template>

<style scoped>
.back {
  margin-bottom: 1.5rem;
}

.detail {
  display: grid;
  grid-template-columns: minmax(180px, 300px) 1fr;
  gap: 2rem;
  align-items: start;
}

h1 {
  margin: 0;
  font-size: clamp(1.5rem, 4vw, 2.25rem);
  line-height: 1.2;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1rem;
  margin: 0.5rem 0 1rem;
}

.rating {
  color: var(--star);
  font-weight: 600;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0 0 1rem;
  padding: 0;
  list-style: none;
}

.tags li {
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  background: var(--surface-2);
  font-size: 0.85rem;
}

.plot {
  max-width: 65ch;
}

dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 0.4rem 1rem;
  margin: 1.5rem 0;
}

dt {
  color: var(--muted);
}

dd {
  margin: 0;
}

.actions {
  display: flex;
  gap: 0.75rem;
}

@media (max-width: 640px) {
  .detail {
    grid-template-columns: 1fr;
  }

  .poster {
    max-width: 220px;
  }
}
</style>
