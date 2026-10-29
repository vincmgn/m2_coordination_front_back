import { declareExposure } from '@/api'

// Exposition = le bouton testé est réellement à l'écran (moitié visible), même définition pour A et B.
// Une déclaration par affichage ; le back déduplique de toute façon (une exposition par navigateur).
// Renvoie une fonction d'arrêt, à appeler si le bouton disparaît avant d'avoir été vu.
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
