<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { listScreenings, type Screening } from '@/api'

const props = defineProps<{ movieId: string }>()

const screenings = ref<Screening[]>([])
const error = ref<string | null>(null)

watch(
  () => props.movieId,
  async (id) => {
    error.value = null
    try {
      screenings.value = await listScreenings(id)
    } catch (e) {
      error.value = (e as Error).message
    }
  },
  { immediate: true },
)

// Séances regroupées par jour.
const days = computed(() => {
  const byDay = new Map<string, Screening[]>()
  for (const s of screenings.value) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s])
  return [...byDay]
})

const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
</script>

<template>
  <section class="screenings">
    <h2>Séances</h2>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="!screenings.length" class="muted">Aucune séance à venir.</p>
    <div v-for="[date, list] in days" :key="date" class="day">
      <h3>{{ dayLabel(date) }}</h3>
      <div class="times">
        <RouterLink
          v-for="s in list"
          :key="s.id"
          :to="`/seances/${s.id}`"
          class="time"
          :class="{ full: s.available === 0 }"
        >
          <strong>{{ s.time }}</strong>
          <span class="muted">{{ s.available ? `${s.available} places` : 'Complet' }}</span>
        </RouterLink>
      </div>
    </div>
  </section>
</template>

<style scoped>
.screenings {
  margin-top: 2rem;
}

h2 {
  margin: 0 0 0.75rem;
  font-size: 1.2rem;
}

h3 {
  margin: 1rem 0 0.5rem;
  font-size: 0.95rem;
  font-weight: 600;
  text-transform: capitalize;
}

.times {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.time {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 6.5rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  text-decoration: none;
  font-size: 0.85rem;
}

.time:hover {
  border-color: var(--accent);
}

.time strong {
  font-size: 1.05rem;
}

.time.full {
  opacity: 0.5;
}
</style>
