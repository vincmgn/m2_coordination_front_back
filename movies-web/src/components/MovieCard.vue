<script setup lang="ts">
import { RouterLink } from 'vue-router'
import type { MovieSummary } from '@/api'
import MoviePoster from './MoviePoster.vue'

defineProps<{ movie: MovieSummary }>()
</script>

<template>
  <RouterLink :to="`/movies/${movie._id}`" class="card">
    <MoviePoster :src="movie.poster" :title="movie.title" />
    <div class="info">
      <h3 class="title">{{ movie.title }}</h3>
      <p class="meta muted">
        <span>{{ movie.year ?? '—' }}</span>
        <span v-if="movie.imdb?.rating" class="rating">★ {{ movie.imdb.rating }}</span>
      </p>
      <p v-if="movie.genres?.length" class="genres muted">{{ movie.genres.join(' · ') }}</p>
    </div>
  </RouterLink>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) + 4px);
  text-decoration: none;
  transition:
    transform 0.15s,
    box-shadow 0.15s;
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow);
}

.info {
  padding: 0 0.25rem 0.25rem;
}

.title {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.meta {
  display: flex;
  justify-content: space-between;
  margin: 0.25rem 0 0;
  font-size: 0.85rem;
}

.rating {
  color: var(--star);
  font-weight: 600;
}

.genres {
  margin: 0.15rem 0 0;
  font-size: 0.8rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
