<script setup lang="ts">
// « Autour de moi » ou une adresse : deux façons d'obtenir un centre, et un message clair pour chaque refus.
// La position n'est demandée qu'au clic, jamais au montage du composant (cours, chapitre 1).
import { ref } from 'vue'
import { GeoError, geocode, getPosition, roundCoord, type SearchCenter } from '@/geo'

const emit = defineEmits<{ center: [center: SearchCenter] }>()
const address = ref('')
const message = ref('')
const locating = ref(false)
const geocoding = ref(false)
const addressInput = ref<HTMLInputElement | null>(null)

function fail(e: unknown) {
  message.value = e instanceof GeoError ? e.message : 'Une erreur est survenue. Saisissez une adresse ou un code postal.'
  // Le refus n'est pas un bug, c'est un parcours : on amène le spectateur à la saisie d'adresse.
  if (e instanceof GeoError && ['insecure', 'unsupported', 'denied', 'unavailable', 'timeout'].includes(e.reason)) addressInput.value?.focus()
}

async function aroundMe() {
  message.value = ''
  locating.value = true
  try {
    const p = await getPosition()
    // Arrondie dès réception : la précision au mètre ne sort pas de cette fonction.
    emit('center', { lat: roundCoord(p.lat), lon: roundCoord(p.lon), accuracyM: Math.round(p.accuracyM), label: 'votre position' })
  } catch (e) {
    fail(e)
  } finally {
    locating.value = false
  }
}

async function aroundAddress() {
  message.value = ''
  geocoding.value = true
  try {
    const place = await geocode(address.value)
    emit('center', { lat: roundCoord(place.lat), lon: roundCoord(place.lon), label: place.label })
  } catch (e) {
    fail(e)
  } finally {
    geocoding.value = false
  }
}
</script>

<template>
  <div class="nearby">
    <button type="button" class="btn btn-primary" :disabled="locating" :aria-busy="locating" @click="aroundMe">
      <span aria-hidden="true">◎</span> {{ locating ? 'Localisation…' : 'Autour de moi (5 km)' }}
    </button>
    <form class="address" @submit.prevent="aroundAddress">
      <label class="sr-only" for="nearby-address">Adresse ou code postal</label>
      <input
        id="nearby-address"
        ref="addressInput"
        v-model="address"
        placeholder="ou une adresse, un code postal"
        maxlength="200"
        autocomplete="street-address"
      />
      <button type="submit" class="btn" :disabled="geocoding || !address.trim()">{{ geocoding ? 'Recherche…' : 'Chercher autour' }}</button>
    </form>
    <p v-if="message" role="alert" class="error">{{ message }}</p>
    <p class="muted note">Votre position sert uniquement à cette recherche, arrondie à environ 100 m : elle n'est pas enregistrée.</p>
  </div>
</template>

<style scoped>
.nearby {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}

.address {
  display: flex;
  flex: 1;
  gap: 0.5rem;
  min-width: min(100%, 18rem);
  max-width: 34rem;
}

.address input {
  flex: 1;
  min-width: 0;
  padding: 0.6rem 0.9rem;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
}

.error,
.note {
  flex-basis: 100%;
  margin: 0;
}

.note {
  font-size: 0.85rem;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
