import { declareExposure } from '@/api'

export function trackExposure(el: Element) {
  const obs = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      obs.disconnect()
      declareExposure()
    },
    { threshold: 0.5 },
  )
  obs.observe(el)
  return () => obs.disconnect()
}
