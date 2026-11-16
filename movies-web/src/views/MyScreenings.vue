<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { cancelBooking, getBookingHistory, listMyBookings, type BookingHistoryEvent, type MyBooking } from '@/api'
import MoviePoster from '@/components/MoviePoster.vue'
import TicketButton from '@/components/TicketButton.vue'

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

const histories = reactive<Record<string, { open: boolean; events?: BookingHistoryEvent[]; error?: string }>>({})

async function toggleHistory(b: MyBooking) {
  histories[b.bookingId] ??= { open: false }
  const h = histories[b.bookingId]!
  h.open = !h.open
  if (!h.open || h.events) return
  try {
    h.events = (await getBookingHistory(b.bookingId)).events
    h.error = undefined
  } catch (e) {
    h.error = (e as Error).message
  }
}

const formatDateTime = (at: string) =>
  new Date(at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

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
            <p class="actions">
              <TicketButton :booking-id="b.bookingId" />
              <button class="link" :aria-expanded="histories[b.bookingId]?.open ?? false" @click="toggleHistory(b)">Historique</button>
            </p>
            <template v-if="histories[b.bookingId]?.open">
              <p v-if="histories[b.bookingId]?.error" class="error">{{ histories[b.bookingId]?.error }}</p>
              <ol v-else-if="histories[b.bookingId]?.events" class="history">
                <li v-for="e in histories[b.bookingId]?.events" :key="e.type">
                  <span class="muted">{{ formatDateTime(e.at) }}</span> {{ e.label }}
                </li>
              </ol>
              <p v-else class="muted">Chargement…</p>
            </template>
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
            <p class="actions">
              <TicketButton :booking-id="b.bookingId" />
              <button class="link" :aria-expanded="histories[b.bookingId]?.open ?? false" @click="toggleHistory(b)">Historique</button>
            </p>
            <template v-if="histories[b.bookingId]?.open">
              <p v-if="histories[b.bookingId]?.error" class="error">{{ histories[b.bookingId]?.error }}</p>
              <ol v-else-if="histories[b.bookingId]?.events" class="history">
                <li v-for="e in histories[b.bookingId]?.events" :key="e.type">
                  <span class="muted">{{ formatDateTime(e.at) }}</span> {{ e.label }}
                </li>
              </ol>
              <p v-else class="muted">Chargement…</p>
            </template>
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
  margin: 2rem 0 1rem;
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

.card .poster {
  flex: none;
  width: 56px;
  padding: 4px;
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

.link {
  padding: 0;
  font: inherit;
  font-size: 0.85rem;
  color: var(--accent);
  text-decoration: underline;
  background: none;
  border: 0;
  cursor: pointer;
}

.info .actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1rem;
  margin-top: 0.25rem;
}

.history {
  margin: 0.25rem 0 0;
  padding-left: 1.25rem;
  font-size: 0.85rem;
}

.when {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  text-transform: capitalize;
}
</style>
