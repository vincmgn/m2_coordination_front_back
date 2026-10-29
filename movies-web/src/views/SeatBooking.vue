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
import { useExperiment } from '@/composables/useExperiment'
import {
  clearDraft,
  clearPending,
  loadContact,
  loadPending,
  loadSeats,
  saveContact,
  savePending,
  saveSeats,
  type PendingBooking,
} from '@/bookingDraft'
import { trackExposure } from '@/composables/trackExposure'

const MAX_SEATS = 10
const FALLBACK_RELOAD_MS = 30_000
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
// Coordonnées pré-remplies avec le brouillon gardé dans le navigateur (voir bookingDraft.ts).
const draft = loadContact()
const name = ref(draft?.name ?? '')
const email = ref(draft?.email ?? '')
const phone = ref(draft?.phone ?? '')
// Même règle que l'API : 8 à 15 chiffres une fois espaces, points, tirets et parenthèses retirés.
const phoneValid = computed(() => /^\+?\d{8,15}$/.test(phone.value.replace(/[\s.()-]/g, '')))
const contactValid = computed(() => !!name.value.trim() && !!email.value.trim() && phoneValid.value)
const booking = ref<Booking | null>(null)
const saving = ref(false)
// Réservation en attente : cliquée pendant une panne, renvoyée automatiquement au retour de l'API.
const queued = ref<PendingBooking | null>(null)

// Brouillon : chaque saisie est gardée, pour ne rien perdre si l'API est hors ligne ou la page rechargée.
watch([name, email, phone], ([n, e, p]) => saveContact({ name: n, email: e, phone: p }))
watch(selected, (seats) => screening.value && !booking.value && saveSeats(screening.value.id, [...seats]))
// Sélection restaurée dès que la séance est lue (au chargement ou au retour de l'API), sans les sièges pris entre-temps.
watch(
  () => screening.value?.id,
  (id) => {
    if (!id || selected.value.size) return
    const seats = loadSeats(id).filter((seat) => !taken.value.has(seat))
    if (seats.length) selected.value = new Set(seats)
  },
)

// Test A/B bouton_reserver_v1 : seul le texte du bouton change (voir movies-api-loadtest/src/routes/ab.ts).
const { variant, counted } = useExperiment()
const cta = ref<HTMLButtonElement | null>(null)
const ctaLabel = computed(() => {
  if (variant.value !== 'B') return 'Réserver'
  return selected.value.size > 1 ? 'Choisir ces places' : 'Choisir cette place'
})

let source: EventSource | null = null
let timer: ReturnType<typeof setInterval> | undefined
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
const pending = new Set<string>()
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
    // API hors ligne (5xx du proxy) ou pas de réseau : message clair, le brouillon reste gardé.
    const offline = !(e instanceof ApiError) || e.status >= 500
    notice.value = offline
      ? 'Service indisponible, vos informations sont gardées.'
      : `Actualisation impossible : ${(e as Error).message}`
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

function connect(id: string) {
  clearTimeout(reconnectTimer)
  source?.close()
  if (stopped) return
  live.value = 'connexion'
  source = new EventSource(screeningEventsUrl(id))
  source.addEventListener('ready', () => {
    live.value = 'en direct'
    reload()
    flushQueued()
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
    taken.value = new Set()
    // Réservation restée en attente (page rechargée pendant la panne) : sièges réaffichés, renvoi au prochain ready.
    queued.value = loadPending(id)
    selected.value = new Set(queued.value?.seats)
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
// Retour du réseau côté navigateur : renvoi immédiat, sans attendre la reconnexion du flux.
window.addEventListener('online', flushQueued)

onBeforeUnmount(() => {
  window.removeEventListener('online', flushQueued)
  stopped = true
  source?.close()
  clearInterval(timer)
  clearTimeout(reconnectTimer)
})

// --- Sélection et réservation ----------------------------------------------------------------------
function toggle(seat: string) {
  if (taken.value.has(seat) || booking.value || queued.value) return
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

// Exposition : le bouton est rendu (après la mise à jour du DOM), il reste au moins une place libre,
// et il est visible à l'écran. Rien en mode de secours (counted = false).
watch(
  [cta, counted, () => available.value > 0],
  ([el, isCounted, anyFree], _old, onCleanup) => {
    if (el && isCounted && anyFree) onCleanup(trackExposure(el))
  },
  { flush: 'post' },
)

// Seule la réponse du POST confirme une réservation personnelle ; le flux SSE ne fait qu'informer.
async function reserve() {
  if (!screening.value || !selected.value.size || !contactValid.value) return
  await send({
    requestId: crypto.randomUUID(),
    seats: sortedSelection.value,
    contact: { name: name.value.trim(), email: email.value.trim(), phone: phone.value.trim() },
    measure: counted.value,
  })
}

// Envoi d'une réservation (premier clic ou renvoi d'une réservation en attente).
// API injoignable (5xx, réseau, réponse perdue) : la demande est mise en attente et renvoyée à la reconnexion.
// Le requestId reste le même : si l'API l'avait déjà enregistrée, elle renvoie la réservation existante.
async function send(request: PendingBooking) {
  // props.id plutôt que screening : au retour de l'API, le renvoi peut partir avant la relecture de la séance.
  if (saving.value) return
  const id = props.id
  saving.value = true
  notice.value = null
  for (const seat of request.seats) pending.add(seat)
  try {
    booking.value = await reserveSeats(id, request.seats, request.contact, request.requestId, request.measure)
    clearPending(id)
    clearDraft(id)
    queued.value = null
    selected.value = new Set()
    notice.value = 'Votre réservation est confirmée.'
  } catch (e) {
    const offline = !(e instanceof ApiError) || e.status >= 500
    if (offline) {
      savePending(id, request)
      queued.value = request
      notice.value = null
      return
    }
    clearPending(id)
    queued.value = null
    if (e.status === 409) {
      pending.clear()
      dropFromSelection(Array.isArray(e.body?.seats) ? (e.body.seats as string[]) : [])
    } else {
      notice.value = e.message
    }
  } finally {
    pending.clear()
    saving.value = false
    reload()
  }
}

// Renvoi de la réservation en attente : appelé à chaque reconnexion (ready du flux SSE, retour du réseau).
function flushQueued() {
  if (queued.value) send(queued.value)
}

function cancelQueued() {
  if (screening.value) clearPending(screening.value.id)
  queued.value = null
  notice.value = 'Réservation en attente annulée.'
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
  <RouterLink v-if="screening" :to="`/movies/${screening.movie._id}`" class="btn back">← {{ screening.movie.title }}
  </RouterLink>

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
        <span v-if="live === 'en direct' && viewers > 1" class="muted"> · {{ viewers }} personnes sur cette
          séance</span>
      </p>
    </header>

    <div class="room">
      <div class="screen" aria-hidden="true">ÉCRAN</div>
      <div class="seats" role="group" :aria-label="`Plan de salle : ${available} places libres`">
        <div v-for="row in screening.room.rows" :key="row" class="row">
          <span class="row-label" aria-hidden="true">{{ row }}</span>
          <button v-for="n in screening.room.seatsPerRow" :key="n" type="button" class="seat"
            :class="[seatState(`${row}${n}`), { flash: justTaken.has(`${row}${n}`), aisle: n === 4 || n === 10 }]"
            :disabled="seatState(`${row}${n}`) === 'taken' || seatState(`${row}${n}`) === 'mine' || !!booking"
            :aria-pressed="selected.has(`${row}${n}`)"
            :aria-label="`${row}${n}, ${STATE_LABEL[seatState(`${row}${n}`)]}`" :title="`${row}${n}`"
            @click="toggle(`${row}${n}`)">
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

      <template v-else-if="queued">
        <p class="queued" role="status">
          ⏳ Réservation en attente : <strong>{{ queued.seats.join(', ') }}</strong> au nom de
          <strong>{{ queued.contact.name }}</strong>. Le service est indisponible : elle sera envoyée automatiquement
          dès son retour.
        </p>
        <button class="btn" :disabled="saving" @click="cancelQueued">Annuler l'envoi</button>
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
        <label class="field">
          <span>E-mail</span>
          <input v-model="email" type="email" required maxlength="254" autocomplete="email" placeholder="vous@exemple.fr" />
        </label>
        <label class="field">
          <span>Téléphone</span>
          <input
            v-model="phone"
            type="tel"
            required
            maxlength="20"
            autocomplete="tel"
            inputmode="tel"
            placeholder="06 12 34 56 78"
            :aria-invalid="!!phone && !phoneValid"
            aria-describedby="phone-error"
          />
          <small v-if="phone && !phoneValid" id="phone-error" class="field-error">
            Numéro invalide : 8 à 15 chiffres, ex. 06 12 34 56 78
          </small>
        </label>
        <!-- Squelette de la taille du bouton tant que la variante est inconnue : jamais de « Réserver » provisoire. -->
        <div v-if="variant === null" class="btn btn-skeleton" aria-busy="true">&nbsp;</div>
        <button
          v-else
          ref="cta"
          type="submit"
          class="btn btn-primary"
          :disabled="!selected.size || !contactValid || saving"
        >
          {{ saving ? 'Réservation…' : ctaLabel }}
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

.btn-skeleton {
  background: var(--surface-2);
  cursor: default;
  animation: pulse 1.6s infinite;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.85rem;
  color: var(--muted);
}

.field input[aria-invalid='true'] {
  border-color: var(--danger);
}

.field-error {
  color: var(--danger);
}

.queued {
  color: var(--star);
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
