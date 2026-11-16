// Géolocalisation de Movies (« Cinémas autour de moi ») : position du navigateur, géocodage d'adresse, paramètres du contrat.
// Règle du module : la position sert à une requête, puis on l'oublie. Rien ici ne l'écrit dans
// console, localStorage, sessionStorage, cookie ou URL de page.

/** Position en degrés WGS 84. Ordre du contrat MediSlot : latitude, puis longitude. */
export interface GeoPoint {lat: number; lon: number}
/** Position du navigateur : accuracyM est le rayon d'incertitude, en mètres. */
export interface DevicePosition extends GeoPoint {accuracyM: number}
/** Adresse géocodée : label est l'adresse reconnue, score la confiance du géocodeur (0 à 1). */
export interface GeocodedPlace extends GeoPoint {label: string; score: number}

/** Centre d'une recherche « autour de », déjà arrondi. label : « votre position » ou l'adresse reconnue. */
export interface SearchCenter extends GeoPoint {label: string; accuracyM?: number}

export type GeoReason = 'insecure' | 'unsupported' | 'denied' | 'unavailable' | 'timeout' | 'not-found' | 'busy' | 'network';

/** Un message par refus, affiché tel quel au patient. Chaque message propose une suite. */
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

/** Rayon de 5 km : inutile de réveiller le GPS ; 10 s au plus ; une position de moins de 5 min suffit. */
export const POSITION_OPTIONS: PositionOptions = {enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000};

/** GeolocationPositionError.code : 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT. */
const REASON_BY_CODE: Record<number, GeoReason> = {1: 'denied', 2: 'unavailable', 3: 'timeout'};

/** Ce dont getPosition a besoin du navigateur, regroupé pour pouvoir tester sans navigateur. */
export interface GeoEnv {secure: boolean; geolocation?: Pick<Geolocation, 'getCurrentPosition'>}

export function browserEnv(): GeoEnv {
  return {
    secure: globalThis.isSecureContext === true,
    geolocation: typeof navigator !== 'undefined' ? navigator.geolocation : undefined,
  };
}

/**
 * Demande la position au navigateur. À n'appeler qu'après un clic sur « Autour de moi » :
 * demandée au chargement, elle est refusée par réflexe, et le refus est mémorisé pour le site.
 */
export function getPosition(env: GeoEnv = browserEnv()): Promise<DevicePosition> {
  if (!env.secure) return Promise.reject(new GeoError('insecure'));       // HTTP hors localhost
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

/** 3 décimales : environ 111 m en latitude. La précision au mètre ne quitte pas l'appareil. */
export function roundCoord(x: number, decimals = 3): number {
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}

export interface NearbyOptions {radiusKm?: number; feature?: string; page?: number; limit?: number}

/** Paramètres de GET /api/cinemas, noms exacts du contrat (GEOLOC.md §1) : lat, lon, radiusKm, page (dès 1), limit. */
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

/** distanceKm (déjà arrondie à 0,1 par le back) : mètres sous 1 km, kilomètres à la française au-delà. */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toLocaleString('fr-FR', {maximumFractionDigits: 1})} km`;
}

/** Géoplateforme de l'IGN : gratuit, sans clé, 50 requêtes par seconde et par adresse IP. */
export const GEOCODER_URL = 'https://data.geopf.fr/geocodage/search';
/** Sous ce score, le premier résultat est souvent une autre commune (choix du cours). */
export const MIN_SCORE = 0.5;

type FetchFn = (url: string) => Promise<Response>;
const cache = new Map<string, GeocodedPlace>();

/** Deux saisies qui ne diffèrent que par les espaces et les majuscules partagent la même entrée de cache. */
export function geocodeKey(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr-FR');
}

export function clearGeocodeCache(): void {
  cache.clear();
}

/** Adresse ou code postal → coordonnées. Un seul appel par adresse : les réponses sont gardées en mémoire. */
export async function geocode(query: string, fetchFn: FetchFn = (url) => fetch(url)): Promise<GeocodedPlace> {
  const key = geocodeKey(query);
  if (key.length < 3) throw new GeoError('not-found');
  const hit = cache.get(key);
  if (hit) return hit;                                    // même adresse : aucun nouvel appel
  let r: Response;
  try {
    r = await fetchFn(`${GEOCODER_URL}?${new URLSearchParams({q: key, limit: '1'})}`);
  } catch {
    throw new GeoError('network');
  }
  if (r.status === 429) throw new GeoError('busy');       // trop de requêtes
  if (!r.ok) throw new GeoError('network');
  const f = (await r.json()).features?.[0];
  if (!f || !(f.properties?.score >= MIN_SCORE)) throw new GeoError('not-found');
  const [lon, lat] = f.geometry.coordinates;              // GeoJSON : [lon, lat], longitude D'ABORD
  const place: GeocodedPlace = {lat, lon, label: f.properties.label, score: f.properties.score};
  cache.set(key, place);
  return place;
}
