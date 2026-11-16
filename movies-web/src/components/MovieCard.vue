<script setup lang="ts">
import { RouterLink } from 'vue-router'
import type { MovieSummary } from '@/api'
import MoviePoster from './MoviePoster.vue'

defineProps<{ movie: MovieSummary }>()
</script>

<template>
  <RouterLink :to="`/movies/${movie._id}`" class="card">
    <MoviePoster :src="movie.poster" :title="movie.title" decorative />
    <div class="info">
      <h3 class="title">{{ movie.title }}</h3>
      <p class="meta muted mono">
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
  gap: 0.75rem;
  border-radius: var(--radius);
  text-decoration: none;
}

.card :deep(img),
.card :deep(.placeholder) {
  transition:
    transform 0.2s,
    box-shadow 0.2s;
}

.card:hover :deep(img),
.card:hover :deep(.placeholder) {
  transform: translateY(-4px);
  box-shadow: 0 12px 40px color-mix(in srgb, var(--accent) 25%, transparent);
}

.title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.meta {
  display: flex;
  gap: 0.75rem;
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
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
