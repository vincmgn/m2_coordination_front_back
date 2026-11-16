// Distance à vol d'oiseau sur une Terre sphérique, et boîte englobante du cercle de recherche.
// Règle du paquet geo : aucune journalisation (console.*), la position d'un spectateur ne doit finir dans aucun journal.

/** Rayon moyen de la Terre (IUGG), en kilomètres : la distance sort dans la même unité. */
export const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/** Formule de haversine. Ordre des paramètres : latitude puis longitude, en degrés WGS 84. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = toRadians(lat1); // Math.sin attend des radians
  const phi2 = toRadians(lat2);
  const dPhi = phi2 - phi1;
  const dLambda = toRadians(lon2 - lon1);
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  // Un arrondi flottant peut donner √h = 1,0000000002 : min(1, …) évite un NaN.
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Arrondi au dixième de kilomètre, pour l'affichage seulement : on ne trie jamais sur l'arrondi. */
export const roundKm = (km: number) => Math.round(km * 10) / 10;

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/** Plus petit rectangle de latitudes et longitudes (degrés) qui contient tout le cercle. */
export function boundingBox(lat: number, lon: number, radiusKm: number): BoundingBox {
  const angle = radiusKm / EARTH_RADIUS_KM; // rayon en radians d'arc
  const halfLat = toDegrees(angle); // ≈ 0,0450° pour 5 km
  const minLat = lat - halfLat;
  const maxLat = lat + halfLat;
  // Pôle dans le cercle : toutes les longitudes sont concernées.
  if (minLat <= -90 || maxLat >= 90) return { minLat: Math.max(minLat, -90), maxLat: Math.min(maxLat, 90), minLon: -180, maxLon: 180 };
  // Un degré de longitude rétrécit vers les pôles (111,2 km × cos φ) : la boîte est plus large en degrés
  // qu'elle n'est haute. Écart maximal de longitude d'un cercle sur la sphère : asin(sin(d/R) / cos φ), ≈ 0,0644° à Lyon.
  const halfLon = toDegrees(Math.asin(Math.min(1, Math.sin(angle) / Math.cos(toRadians(lat)))));
  const minLon = lon - halfLon;
  const maxLon = lon + halfLon;
  // Antiméridien (±180°) traversé : un intervalle simple ne sait pas « faire le tour ».
  // On élargit à toutes les longitudes ; le calcul exact écarte ensuite ce qui sort du cercle.
  if (minLon < -180 || maxLon > 180) return { minLat, maxLat, minLon: -180, maxLon: 180 };
  return { minLat, maxLat, minLon, maxLon };
}
