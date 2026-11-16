<script setup lang="ts">
import { ref } from 'vue'
import { FALLBACK, openTicket, realBrowser, saveTicket, TicketError } from '@/ticket'

const props = defineProps<{ bookingId: string }>()

const loading = ref<'open' | 'save' | null>(null)
const error = ref('')

async function run(save: boolean) {
  if (loading.value) return
  loading.value = save ? 'save' : 'open'
  error.value = ''
  try {
    await (save ? saveTicket : openTicket)(props.bookingId, realBrowser)
  } catch (e) {
    error.value = e instanceof TicketError ? e.message : FALLBACK
  } finally {
    loading.value = null
  }
}
</script>

<template>
  <span class="ticket">
    <button class="link" :disabled="!!loading" :aria-busy="loading === 'open'" @click="run(false)">
      {{ loading === 'open' ? 'Préparation…' : 'Mon billet (PDF)' }}
    </button>
    <button class="link" :disabled="!!loading" :aria-busy="loading === 'save'" @click="run(true)">
      {{ loading === 'save' ? 'Préparation…' : 'Enregistrer' }}
    </button>
    <span v-if="error" class="error" role="alert">{{ error }}</span>
  </span>
</template>

<style scoped>
.ticket {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.25rem 1rem;
  align-items: baseline;
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

.link:disabled {
  color: var(--muted);
  cursor: progress;
}

.error {
  flex-basis: 100%;
  margin: 0;
  font-size: 0.85rem;
}
</style>
