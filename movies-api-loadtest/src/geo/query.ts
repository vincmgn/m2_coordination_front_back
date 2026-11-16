import { HttpError } from "../http-error.js";

export const DEFAULT_RADIUS_KM = 5;
export const MAX_RADIUS_KM = 20;
export const MAX_LIMIT = 50;
export const DEFAULT_LIMIT = 6;
export const FEATURES = ["vo", "imax", "pmr"] as const;

export interface NearbyQuery {
  lat: number;
  lon: number;
  radiusKm: number;
  feature: string;
  page: number;
  limit: number;
}

type Raw = Record<string, unknown>;

const bad = (message: string) => new HttpError(400, message);

function number(raw: Raw, name: string): number | undefined {
  const value = raw[name];
  if (value === undefined) return undefined;
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (Number.isNaN(n) && value !== "NaN") throw bad(`Paramètre invalide : ${name}.`);
  return n;
}

function integer(raw: Raw, name: string, fallback: number): number {
  const value = raw[name];
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) throw bad(`Paramètre invalide : ${name}.`);
  return Number(value);
}

export const isNearby = (raw: Raw) => raw.lat !== undefined || raw.lon !== undefined || raw.radiusKm !== undefined;

export function parseNearbyQuery(raw: Raw): NearbyQuery {
  const lat = number(raw, "lat");
  const lon = number(raw, "lon");
  const radius = number(raw, "radiusKm");
  if (lat === undefined || lon === undefined) throw bad("Indiquez lat et lon ensemble.");
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw bad("Latitude invalide : entre -90 et 90 degrés.");
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw bad("Longitude invalide : entre -180 et 180 degrés.");
  const radiusKm = radius ?? DEFAULT_RADIUS_KM;
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > MAX_RADIUS_KM) throw bad("Rayon invalide : plus de 0 et au plus 20 km.");
  const page = integer(raw, "page", 1);
  const limit = integer(raw, "limit", DEFAULT_LIMIT);
  if (page < 1 || limit < 1 || limit > MAX_LIMIT) throw bad("Pagination invalide : page à partir de 1, limit de 1 à 50.");
  return { lat, lon, radiusKm, feature: parseFeature(raw), page, limit };
}

export function parseFeature(raw: Raw): string {
  const value = raw.feature;
  if (value === undefined || value === "") return "";
  if (typeof value !== "string" || !(FEATURES as readonly string[]).includes(value)) throw bad("Équipement invalide : vo, imax ou pmr.");
  return value;
}
