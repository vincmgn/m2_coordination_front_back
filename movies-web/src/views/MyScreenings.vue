<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { cancelBooking, listMyBookings, type MyBooking } from '@/api'
import MoviePoster from '@/components/MoviePoster.vue'

const bookings = ref<MyBooking[] | null>(null)
const error = ref<string | null>(null)

async function load() {
  try {
    bookings.value = await listMyBookings()
    error.value = null
  } catch (e) {
    error.value = (e as Error).message
  }
}
load()

const upcoming = computed(() => bookings.value?.filter((b) => b.upcoming) ?? [])
const past = computed(() => bookings.value?.filter((b) => !b.upcoming) ?? [])

async function cancel(b: MyBooking) {
  if (!confirm(`Annuler la réservation ${b.seats.join(', ')} pour « ${b.movie.title} » ?`)) return
  try {
    await cancelBooking(b.screeningId, b.bookingId)
    bookings.value = bookings.value?.filter((x) => x.bookingId !== b.bookingId) ?? null
  } catch (e) {
    error.value = (e as Error).message
  }
}

const formatDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
</script>

<template>
  <h1>Mes séances</h1>

  <p v-if="error" class="error">{{ error }}</p>
  <p v-if="!bookings && !error" class="muted">Chargement…</p>

  <template v-else-if="bookings">
    <p v-if="!bookings.length" class="muted">
      Aucune réservation pour l'instant. <RouterLink to="/">Choisir un film</RouterLink>
    </p>

    <section v-if="upcoming.length">
      <h2>À venir</h2>
      <ul class="list">
        <li v-for="b in upcoming" :key="b.bookingId" class="card">
          <MoviePoster :src="b.movie.poster" :title="b.movie.title" class="poster" decorative />
          <div class="info">
            <RouterLink :to="`/seances/${b.screeningId}`" class="title">{{ b.movie.title }}</RouterLink>
            <p class="muted when">{{ formatDate(b.date) }} · {{ b.time }}</p>
            <p>Sièges {{ b.seats.join(', ') }} <span class="muted">({{ b.seats.length }} place{{ b.seats.length > 1 ? 's' : '' }})</span></p>
          </div>
          <button class="btn btn-danger" @click="cancel(b)">Annuler</button>
        </li>
      </ul>
    </section>

    <section v-if="past.length">
      <h2>Passées</h2>
      <ul class="list">
        <li v-for="b in past" :key="b.bookingId" class="card past">
          <MoviePoster :src="b.movie.poster" :title="b.movie.title" class="poster" decorative />
          <div class="info">
            <span class="title">{{ b.movie.title }}</span>
            <p class="muted when">{{ formatDate(b.date) }} · {{ b.time }}</p>
            <p>Sièges {{ b.seats.join(', ') }}</p>
          </div>
        </li>
      </ul>
    </section>
  </template>
</template>

<style scoped>
h1 {
  margin-top: 0;
}

h2 {
  font-size: 1.1rem;
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
  align-items: center;
  gap: 1rem;
  padding: 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) + 4px);
}

.card.past {
  opacity: 0.65;
}

.poster {
  flex: none;
  width: 56px;
}

.info {
  flex: 1;
  min-width: 0;
}

.info p {
  margin: 0;
}

.title {
  font-weight: 600;
  text-decoration: none;
}

.when {
  text-transform: capitalize;
}
</style>
