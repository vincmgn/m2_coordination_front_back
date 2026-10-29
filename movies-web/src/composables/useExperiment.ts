import { onMounted, ref } from 'vue'
import { getAssignment, type Variant } from '@/api'

// Délai maximal d'attente de la variante : au-delà, version A hors test (pas de page bloquée).
const TIMEOUT_MS = 800

// variant : null tant que la réponse n'est pas arrivée (on affiche un squelette, jamais un A provisoire).
// counted : false en mode de secours (erreur, délai dépassé, expérience désactivée) : A affiché, rien n'est mesuré.
export function useExperiment() {
  const variant = ref<Variant | null>(null)
  const counted = ref(false)

  onMounted(async () => {
    try {
      const res = await getAssignment(AbortSignal.timeout(TIMEOUT_MS))
      variant.value = res.variant
      counted.value = res.enabled
    } catch {
      variant.value = 'A'
    }
  })

  return { variant, counted }
}
