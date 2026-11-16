<script setup lang="ts">
// Défi : la liste posée sur une carte Leaflet. La carte est un plus : la liste reste lisible sans elle.
// Tuiles OpenStreetMap : attribution visible, aucun préchargement (politique d'usage de l'OSMF).
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Cinema } from '@/api'
import { formatDistance, type GeoPoint } from '@/geo'

const props = defineProps<{ center: GeoPoint; radiusKm: number; items: Cinema[] }>()
const el = ref<HTMLElement | null>(null)
let map: L.Map | null = null
let layer: L.LayerGroup | null = null

function label(text: string) {
  const div = document.createElement('div')
  div.textContent = text // texte, jamais du HTML venu de l'API
  return div
}

function draw() {
  if (!map || !layer) return
  layer.clearLayers()
  // Cadrer d'abord : un cercle n'a de bornes qu'une fois la carte dotée d'une vue.
  map.fitBounds(L.latLng(props.center.lat, props.center.lon).toBounds(props.radiusKm * 2000), { padding: [12, 12] })
  // Leaflet attend [lat, lng] : l'inverse de GeoJSON.
  L.circle([props.center.lat, props.center.lon], { radius: props.radiusKm * 1000, color: '#ffb547', weight: 2, fillOpacity: 0.06 }).addTo(layer)
  L.circleMarker([props.center.lat, props.center.lon], { radius: 5, color: '#0d0d11', fillColor: '#f3f1ec', fillOpacity: 1 })
    .bindTooltip('Centre de la recherche')
    .addTo(layer)
  for (const c of props.items) {
    const distance = c.distanceKm == null ? '' : ` · ${formatDistance(c.distanceKm)}`
    L.circleMarker([c.latitude, c.longitude], { radius: 8, color: '#0d0d11', weight: 2, fillColor: '#ffb547', fillOpacity: 1 })
      .bindPopup(label(`${c.name}${distance}`))
      .addTo(layer)
  }
}

onMounted(() => {
  map = L.map(el.value!, { scrollWheelZoom: false })
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map)
  layer = L.layerGroup().addTo(map)
  draw()
})
watch(() => [props.center, props.items, props.radiusKm], draw)
onBeforeUnmount(() => {
  map?.remove()
  map = null
  layer = null
})
</script>

<template>
  <figure class="map">
    <div ref="el" class="canvas"></div>
    <figcaption class="muted">
      Carte : {{ items.length }} cinéma{{ items.length > 1 ? 's' : '' }} de cette page dans un cercle de {{ radiusKm }} km. La liste
      ci-dessous donne les mêmes informations.
    </figcaption>
  </figure>
</template>

<style scoped>
.map {
  margin: 0 0 1.25rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface);
}

.canvas {
  height: 320px;
}

figcaption {
  padding: 0.6rem 0.9rem;
  font-size: 0.85rem;
}
</style>
