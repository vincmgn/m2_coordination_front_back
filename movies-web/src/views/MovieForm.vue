<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { createMovie, getMovie, listGenres, updateMovie, type MovieInput } from '@/api'

// Sans id : création ; avec id : modification du film existant.
const props = defineProps<{ id?: string }>()
const router = useRouter()
const isEdit = computed(() => Boolean(props.id))

const form = reactive({ title: '', year: '', genres: [] as string[], poster: '', plot: '' })
const genres = ref<string[]>([])
const loading = ref(isEdit.value)
const saving = ref(false)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    const [allGenres, movie] = await Promise.all([listGenres(), props.id ? getMovie(props.id) : null])
    genres.value = allGenres
    if (movie) {
      Object.assign(form, {
        title: movie.title,
        year: movie.year?.toString() ?? '',
        genres: movie.genres ?? [],
        poster: movie.poster ?? '',
        plot: movie.plot ?? '',
      })
    }
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
})

async function submit() {
  // Seuls les champs remplis sont envoyés ; l'API valide à nouveau (title obligatoire, year entier…).
  const payload: MovieInput = { title: form.title.trim(), genres: form.genres }
  if (form.year) payload.year = Number(form.year)
  if (form.poster.trim()) payload.poster = form.poster.trim()
  if (form.plot.trim()) payload.plot = form.plot.trim()

  saving.value = true
  error.value = null
  try {
    const movie = props.id ? await updateMovie(props.id, payload) : await createMovie(payload)
    router.push(`/movies/${movie._id}`)
  } catch (e) {
    error.value = (e as Error).message
    saving.value = false
  }
}
</script>

<template>
  <h1>{{ isEdit ? 'Modifier le film' : 'Ajouter un film' }}</h1>

  <p v-if="loading" class="muted">Chargement…</p>

  <form v-else class="form" @submit.prevent="submit">
    <label class="field">
      <span>Titre *</span>
      <input v-model="form.title" required maxlength="300" />
    </label>

    <label class="field">
      <span>Année</span>
      <input v-model="form.year" type="number" min="1880" max="2100" step="1" />
    </label>

    <fieldset class="field">
      <legend>Genres</legend>
      <div class="genres">
        <label v-for="genre in genres" :key="genre" class="genre">
          <input v-model="form.genres" type="checkbox" :value="genre" />
          {{ genre }}
        </label>
      </div>
    </fieldset>

    <label class="field">
      <span>URL de l'affiche</span>
      <input v-model="form.poster" type="url" placeholder="https://…" />
    </label>

    <label class="field">
      <span>Résumé</span>
      <textarea v-model="form.plot" rows="4" />
    </label>

    <p v-if="error" class="error">{{ error }}</p>

    <div class="actions">
      <button type="submit" class="btn btn-primary" :disabled="saving">
        {{ saving ? 'Enregistrement…' : isEdit ? 'Enregistrer' : 'Créer le film' }}
      </button>
      <button type="button" class="btn" @click="router.back()">Annuler</button>
    </div>
  </form>
</template>

<style scoped>
h1 {
  margin-top: 0;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  max-width: 640px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  border: 0;
  font-size: 0.9rem;
  color: var(--muted);
}

.field legend {
  margin-bottom: 0.35rem;
  padding: 0;
}

.genres {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 0.35rem 1rem;
  color: var(--text);
}

.genre {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.genre input {
  width: auto;
}

.actions {
  display: flex;
  gap: 0.75rem;
}
</style>
