export const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const dPhi = phi2 - phi1;
  const dLambda = toRadians(lon2 - lon1);
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const roundKm = (km: number) => Math.round(km * 10) / 10;

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export function boundingBox(lat: number, lon: number, radiusKm: number): BoundingBox {
  const angle = radiusKm / EARTH_RADIUS_KM;
  const halfLat = toDegrees(angle);
  const minLat = lat - halfLat;
  const maxLat = lat + halfLat;
  if (minLat <= -90 || maxLat >= 90) return { minLat: Math.max(minLat, -90), maxLat: Math.min(maxLat, 90), minLon: -180, maxLon: 180 };
  const halfLon = toDegrees(Math.asin(Math.min(1, Math.sin(angle) / Math.cos(toRadians(lat)))));
  const minLon = lon - halfLon;
  const maxLon = lon + halfLon;
  if (minLon < -180 || maxLon > 180) return { minLat, maxLat, minLon: -180, maxLon: 180 };
  return { minLat, maxLat, minLon, maxLon };
}
