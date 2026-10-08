<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import {
  ApiError,
  cancelBooking,
  getScreening,
  reserveSeats,
  screeningEventsUrl,
  type Booking,
  type ScreeningDetail,
} from '@/api'

const MAX_SEATS = 10
// Relecture de secours (filet de sécurité) : rattrape une notification perdue. Mettre 0 pour tester SSE seul.
const FALLBACK_RELOAD_MS = 30_000
// Délai avant de recréer le flux quand le navigateur a abandonné la reconnexion (voir connect()).
const RECONNECT_MS = 3_000

const props = defineProps<{ id: string }>()

const screening = ref<ScreeningDetail | null>(null)
const error = ref<string | null>(null)
const taken = ref(new Set<string>())
const selected = ref(new Set<string>())
const justTaken = ref(new Set<string>()) // sièges réservés à l'instant par quelqu'un d'autre (animation)
const viewers = ref(0)
const live = ref<'connexion' | 'en direct' | 'interrompu'>('connexion')
const notice = ref<string | null>(null)
const name = ref('')
const booking = ref<Booking | null>(null)
const saving = ref(false)

let source: EventSource | null = null
let timer: ReturnType<typeof setInterval> | undefined
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
// Sièges que cette page est en train de réserver : la relecture peut les voir « réservés » avant la réponse
// du POST, il ne faut pas les présenter comme réservés par quelqu'un d'autre.
const pending = new Set<string>()

// --- Relecture sérialisée (stratégie « relire après notification ») -------------------------------
// Deux notifications proches ne lancent pas deux GET concurrents : une seule lecture à la fois, et une
// relecture de plus si une demande est arrivée pendant la lecture en cours.
let running = false
let dirty = false
let stopped = false

async function reload() {
  if (stopped) return
  dirty = true
  if (running) return
  running = true
  try {
    while (dirty && !stopped) {
      dirty = false
      const data = await getScreening(props.id)
      if (stopped) return
      applyTaken(data.taken)
      screening.value = data
      error.value = null
    }
  } catch (e) {
    notice.value = `Actualisation impossible : ${(e as Error).message}`
  } finally {
    running = false
  }
}

function applyTaken(next: string[]) {
  const nextSet = new Set(next)
  const mine = new Set(booking.value?.seats)
  const byOthers = next.filter((s) => !taken.value.has(s) && !pending.has(s) && !mine.has(s))
  flash(byOthers)
  taken.value = nextSet
  // Un siège sélectionné ici vient d'être réservé ailleurs : on le retire de la sélection et on prévient.
  dropFromSelection([...selected.value].filter((s) => nextSet.has(s) && !pending.has(s)))
}

function dropFromSelection(seats: string[]) {
  if (!seats.length) return
  const next = new Set(selected.value)
  for (const seat of seats) next.delete(seat)
  selected.value = next
  notice.value = `${seats.join(', ')} vient d'être réservé par quelqu'un d'autre : choisissez d'autres sièges.`
}

function flash(seats: string[]) {
  if (!seats.length) return
  justTaken.value = new Set([...justTaken.value, ...seats])
  setTimeout(() => {
    const next = new Set(justTaken.value)
    for (const seat of seats) next.delete(seat)
    justTaken.value = next
  }, 1500)
}

// --- Flux SSE --------------------------------------------------------------------------------------
// Un seul EventSource par page. ready (à chaque abonnement, donc après une reconnexion) et seat-updated
// déclenchent une relecture : l'écran affiche toujours l'état renvoyé par l'API.
function connect(id: string) {
  clearTimeout(reconnectTimer)
  source?.close()
  if (stopped) return
  live.value = 'connexion'
  source = new EventSource(screeningEventsUrl(id))
  source.addEventListener('ready', () => {
    live.value = 'en direct'
    reload()
  })
  source.addEventListener('seat-updated', () => reload())
  source.addEventListener('viewers', (e) => (viewers.value = JSON.parse(e.data).count))
  source.onerror = () => {
    live.value = 'interrompu'
    // Pas de close() ici : après une coupure, EventSource se reconnecte tout seul puis reçoit un nouveau ready.
    // Exception : si la reconnexion obtient une réponse qui n'est pas un flux (ex. 502 du proxy pendant que
    // l'API est arrêtée), le navigateur abandonne définitivement (readyState CLOSED). On recrée alors le flux.
    if (source?.readyState === EventSource.CLOSED) {
      clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(() => connect(id), RECONNECT_MS)
    }
  }
}

watch(
  () => props.id,
  async (id) => {
    screening.value = null
    error.value = null
    booking.value = null
    notice.value = null
    selected.value = new Set()
    taken.value = new Set()
    try {
      screening.value = await getScreening(id)
      taken.value = new Set(screening.value.taken)
    } catch (e) {
      // Séance inexistante ou invalide (4xx) : erreur définitive.
      if (e instanceof ApiError && e.status < 500) {
        error.value = e.message
        return
      }
      // Serveur indisponible : le flux se connectera dès son retour, et son ready déclenchera la lecture.
      error.value = 'Serveur indisponible : nouvelle tentative automatique…'
    }
    connect(id)
  },
  { immediate: true },
)

if (FALLBACK_RELOAD_MS > 0) timer = setInterval(() => screening.value && reload(), FALLBACK_RELOAD_MS)

// Démontage : fermer le flux, arrêter le minuteur et empêcher toute relecture de modifier l'écran.
onBeforeUnmount(() => {
  stopped = true
  source?.close()
  clearInterval(timer)
  clearTimeout(reconnectTimer)
})

// --- Sélection et réservation ----------------------------------------------------------------------
function toggle(seat: string) {
  if (taken.value.has(seat) || booking.value) return
  notice.value = null
  const next = new Set(selected.value)
  if (next.has(seat)) next.delete(seat)
  else if (next.size < MAX_SEATS) next.add(seat)
  else notice.value = `${MAX_SEATS} sièges maximum par réservation.`
  selected.value = next
}

const sortedSelection = computed(() =>
  [...selected.value].sort((a, b) => a[0]!.localeCompare(b[0]!) || Number(a.slice(1)) - Number(b.slice(1))),
)
const available = computed(() => (screening.value ? screening.value.room.capacity - taken.value.size : 0))

// Seule la réponse du POST confirme une réservation personnelle ; le flux SSE ne fait qu'informer.
async function reserve() {
  if (!screening.value || !selected.value.size || !name.value.trim()) return
  saving.value = true
  notice.value = null
  for (const seat of selected.value) pending.add(seat)
  try {
    booking.value = await reserveSeats(screening.value.id, sortedSelection.value, name.value.trim())
    selected.value = new Set()
    notice.value = 'Votre réservation est confirmée.'
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      // Quelqu'un a été plus rapide : les sièges en conflit sont retirés, le reste de la sélection est gardé.
      pending.clear()
      dropFromSelection(Array.isArray(e.body?.seats) ? (e.body.seats as string[]) : [])
    } else if (e instanceof ApiError) {
      notice.value = e.message
    } else {
      // Réponse perdue (réseau) : l'API a peut-être enregistré la réservation.
      notice.value = 'Résultat incertain (réponse perdue) : vérifiez la salle avant de réessayer.'
    }
  } finally {
    pending.clear()
    saving.value = false
    reload()
  }
}

async function cancel() {
  if (!screening.value || !booking.value) return
  await cancelBooking(screening.value.id, booking.value.bookingId)
  booking.value = null
  notice.value = 'Réservation annulée.'
  reload()
}

function seatState(seat: string) {
  if (booking.value?.seats.includes(seat)) return 'mine'
  if (selected.value.has(seat)) return 'selected'
  if (taken.value.has(seat)) return 'taken'
  return 'free'
}
const STATE_LABEL = { free: 'libre', selected: 'sélectionné', taken: 'réservé', mine: 'votre réservation' }

const formatDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
</script>

<template>
  <RouterLink v-if="screening" :to="`/movies/${screening.movie._id}`" class="btn back">← {{ screening.movie.title }}</RouterLink>

  <p v-if="error" class="error">{{ error }}</p>
  <p v-else-if="!screening" class="muted">Chargement…</p>

  <section v-else class="booking">
    <header class="head">
      <div>
        <h1>{{ screening.movie.title }}</h1>
        <p class="muted when">{{ formatDate(screening.date) }} · {{ screening.time }}</p>
      </div>
      <p class="live" :class="live.replace(' ', '-')" role="status">
        <span class="dot" aria-hidden="true" />
        {{ live === 'en direct' ? 'En direct' : live === 'connexion' ? 'Connexion…' : 'Connexion interrompue…' }}
        <span v-if="live === 'en direct' && viewers > 1" class="muted"> · {{ viewers }} personnes sur cette séance</span>
      </p>
    </header>

    <div class="room">
      <div class="screen" aria-hidden="true">ÉCRAN</div>
      <div class="seats" role="group" :aria-label="`Plan de salle : ${available} places libres`">
        <div v-for="row in screening.room.rows" :key="row" class="row">
          <span class="row-label" aria-hidden="true">{{ row }}</span>
          <button
            v-for="n in screening.room.seatsPerRow"
            :key="n"
            type="button"
            class="seat"
            :class="[seatState(`${row}${n}`), { flash: justTaken.has(`${row}${n}`), aisle: n === 4 || n === 10 }]"
            :disabled="seatState(`${row}${n}`) === 'taken' || seatState(`${row}${n}`) === 'mine' || !!booking"
            :aria-pressed="selected.has(`${row}${n}`)"
            :aria-label="`${row}${n}, ${STATE_LABEL[seatState(`${row}${n}`)]}`"
            :title="`${row}${n}`"
            @click="toggle(`${row}${n}`)"
          >
            {{ n }}
          </button>
          <span class="row-label" aria-hidden="true">{{ row }}</span>
        </div>
      </div>
      <ul class="legend muted">
        <li><span class="seat free" /> Libre</li>
        <li><span class="seat selected" /> Votre sélection</li>
        <li><span class="seat taken" /> Réservé</li>
        <li><span class="seat mine" /> Votre réservation</li>
      </ul>
    </div>

    <aside class="panel">
      <p class="muted">{{ available }} / {{ screening.room.capacity }} places libres</p>

      <template v-if="booking">
        <p class="success">
          ✅ Réservé au nom de <strong>{{ booking.name }}</strong> : {{ booking.seats.join(', ') }}
        </p>
        <button class="btn" @click="cancel">Annuler la réservation</button>
      </template>

      <form v-else class="form" @submit.prevent="reserve">
        <p>
          <strong>{{ selected.size ? sortedSelection.join(', ') : 'Aucun siège sélectionné' }}</strong>
          <span v-if="selected.size" class="muted"> ({{ selected.size }} place{{ selected.size > 1 ? 's' : '' }})</span>
        </p>
        <label class="field">
          <span>Nom</span>
          <input v-model="name" required maxlength="60" autocomplete="name" placeholder="Votre nom" />
        </label>
        <button type="submit" class="btn btn-primary" :disabled="!selected.size || !name.trim() || saving">
          {{ saving ? 'Réservation…' : 'Réserver' }}
        </button>
      </form>

      <p v-if="notice" class="notice" role="alert">{{ notice }}</p>
    </aside>
  </section>
</template>

<style scoped>
.back {
  margin-bottom: 1.5rem;
}

.booking {
  display: grid;
  grid-template-columns: 1fr 280px;
  grid-template-areas: 'head head' 'room panel';
  gap: 1.5rem;
  align-items: start;
}

.head {
  grid-area: head;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: end;
  gap: 0.5rem 1rem;
}

h1 {
  margin: 0;
  font-size: clamp(1.4rem, 3.5vw, 2rem);
}

.when {
  margin: 0.25rem 0 0;
  text-transform: capitalize;
}

.live {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-size: 0.9rem;
}

.dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
  background: var(--muted);
}

.en-direct .dot {
  background: #2fb36d;
  animation: pulse 1.6s infinite;
}

.interrompu .dot {
  background: var(--star);
}

@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}

.room {
  grid-area: room;
  overflow-x: auto;
  padding: 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) + 4px);
}

.screen {
  margin: 0 auto 1.5rem;
  max-width: 420px;
  padding: 0.3rem;
  border-radius: 0 0 50% 50% / 0 0 100% 100%;
  background: var(--surface-2);
  color: var(--muted);
  font-size: 0.75rem;
  letter-spacing: 0.3em;
  text-align: center;
}

.seats {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  min-width: max-content;
}

.row {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.row-label {
  width: 1.2rem;
  color: var(--muted);
  font-size: 0.8rem;
  text-align: center;
}

.seat {
  width: 1.9rem;
  height: 1.9rem;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px 6px 3px 3px;
  font-size: 0.7rem;
  cursor: pointer;
  transition:
    background 0.2s,
    transform 0.1s;
}

.seat.aisle {
  margin-right: 0.9rem;
}

.seat.free {
  background: var(--surface-2);
}

.seat.free:hover {
  border-color: var(--accent);
}

.seat.selected {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
}

.seat.taken {
  background: var(--border);
  color: transparent;
  cursor: not-allowed;
}

.seat.mine {
  background: #2fb36d;
  border-color: #2fb36d;
  color: #fff;
}

.seat.flash {
  animation: taken 1.5s;
}

@keyframes taken {
  0%,
  40% {
    background: var(--star);
    transform: scale(1.15);
  }
}

.legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem 1.25rem;
  margin: 1.25rem 0 0;
  padding: 0;
  list-style: none;
  font-size: 0.8rem;
}

.legend li {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.legend .seat {
  display: inline-block;
  width: 1rem;
  height: 1rem;
  cursor: default;
}

.panel {
  grid-area: panel;
  position: sticky;
  top: 5rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) + 4px);
}

.panel p {
  margin: 0;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.85rem;
  color: var(--muted);
}

.success {
  color: #2fb36d;
}

.notice {
  padding: 0.6rem 0.75rem;
  border-radius: var(--radius);
  background: var(--surface-2);
  font-size: 0.9rem;
}

@media (max-width: 760px) {
  .booking {
    grid-template-columns: 1fr;
    grid-template-areas: 'head' 'room' 'panel';
  }

  .panel {
    position: static;
  }
}
</style>
