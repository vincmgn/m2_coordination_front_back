export interface GeoPoint {lat: number; lon: number}
export interface DevicePosition extends GeoPoint {accuracyM: number}
export interface GeocodedPlace extends GeoPoint {label: string; score: number}

export interface SearchCenter extends GeoPoint {label: string; accuracyM?: number}

export type GeoReason = 'insecure' | 'unsupported' | 'denied' | 'unavailable' | 'timeout' | 'not-found' | 'busy' | 'network';

export const GEO_MESSAGES: Record<GeoReason, string> = {
  insecure: 'La localisation exige une page sécurisée (HTTPS). Saisissez une adresse ou un code postal.',
  unsupported: 'Votre navigateur ne sait pas donner votre position. Saisissez une adresse ou un code postal.',
  denied: 'Localisation refusée. Saisissez une adresse ou un code postal.',
  unavailable: 'Position introuvable pour le moment. Saisissez une adresse.',
  timeout: 'La localisation prend trop de temps. Réessayez ou saisissez une adresse.',
  'not-found': 'Adresse introuvable ou trop imprécise. Précisez la ville ou le code postal.',
  busy: 'Le service d\'adresses est très sollicité. Réessayez dans une seconde.',
  network: 'Le service d\'adresses ne répond pas. Vérifiez le réseau puis réessayez.',
};

export class GeoError extends Error {
  constructor(public readonly reason: GeoReason) {
    super(GEO_MESSAGES[reason]);
    this.name = 'GeoError';
  }
}

export const POSITION_OPTIONS: PositionOptions = {enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000};

const REASON_BY_CODE: Record<number, GeoReason> = {1: 'denied', 2: 'unavailable', 3: 'timeout'};

export interface GeoEnv {secure: boolean; geolocation?: Pick<Geolocation, 'getCurrentPosition'>}

export function browserEnv(): GeoEnv {
  return {
    secure: globalThis.isSecureContext === true,
    geolocation: typeof navigator !== 'undefined' ? navigator.geolocation : undefined,
  };
}

export function getPosition(env: GeoEnv = browserEnv()): Promise<DevicePosition> {
  if (!env.secure) return Promise.reject(new GeoError('insecure'));
  if (!env.geolocation) return Promise.reject(new GeoError('unsupported'));
  const geolocation = env.geolocation;
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      p => resolve({lat: p.coords.latitude, lon: p.coords.longitude, accuracyM: p.coords.accuracy}),
      e => reject(new GeoError(REASON_BY_CODE[e.code] ?? 'unavailable')),
      POSITION_OPTIONS,
    );
  });
}

export function roundCoord(x: number, decimals = 3): number {
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}

export interface NearbyOptions {radiusKm?: number; feature?: string; page?: number; limit?: number}

export function nearbyParams(center: GeoPoint, {radiusKm = 5, feature = '', page = 1, limit = 6}: NearbyOptions = {}): URLSearchParams {
  const params = new URLSearchParams({
    lat: String(roundCoord(center.lat)),
    lon: String(roundCoord(center.lon)),
    radiusKm: String(radiusKm),
    page: String(page),
    limit: String(limit),
  });
  if (feature) params.set('feature', feature);
  return params;
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toLocaleString('fr-FR', {maximumFractionDigits: 1})} km`;
}

export const GEOCODER_URL = 'https://data.geopf.fr/geocodage/search';
export const MIN_SCORE = 0.5;

type FetchFn = (url: string) => Promise<Response>;
const cache = new Map<string, GeocodedPlace>();

export function geocodeKey(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr-FR');
}

export function clearGeocodeCache(): void {
  cache.clear();
}

export async function geocode(query: string, fetchFn: FetchFn = (url) => fetch(url)): Promise<GeocodedPlace> {
  const key = geocodeKey(query);
  if (key.length < 3) throw new GeoError('not-found');
  const hit = cache.get(key);
  if (hit) return hit;
  let r: Response;
  try {
    r = await fetchFn(`${GEOCODER_URL}?${new URLSearchParams({q: key, limit: '1'})}`);
  } catch {
    throw new GeoError('network');
  }
  if (r.status === 429) throw new GeoError('busy');
  if (!r.ok) throw new GeoError('network');
  const f = (await r.json()).features?.[0];
  if (!f || !(f.properties?.score >= MIN_SCORE)) throw new GeoError('not-found');
  const [lon, lat] = f.geometry.coordinates;
  const place: GeocodedPlace = {lat, lon, label: f.properties.label, score: f.properties.score};
  cache.set(key, place);
  return place;
}
