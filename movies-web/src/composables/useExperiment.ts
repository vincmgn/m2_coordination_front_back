import { onMounted, ref } from 'vue'
import { getAssignment, type Variant } from '@/api'

const TIMEOUT_MS = 800

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
