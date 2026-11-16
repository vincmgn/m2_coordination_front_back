import { Router } from "express";
import type { Collection } from "mongodb";
import { getDB } from "../db.js";
import { roundKm } from "../geo/distance.js";
import { boxFinder, geoNearFinder, type Cinema, type NearbyFinder } from "../geo/finders.js";
import { DEFAULT_LIMIT, isNearby, MAX_LIMIT, parseFeature, parseNearbyQuery } from "../geo/query.js";
import { searchNearby } from "../geo/service.js";
import { HttpError } from "../http-error.js";

export interface CinemasDeps {
  cinemas: () => Collection<Cinema>;
  finder: NearbyFinder;
}

const view = (c: Cinema, distanceKm: number | null = null) => ({
  slug: c.slug,
  name: c.name,
  address: c.address,
  city: c.city,
  features: c.features,
  latitude: c.latitude,
  longitude: c.longitude,
  distanceKm: distanceKm === null ? null : roundKm(distanceKm),
});

export function cinemasRouter(deps: CinemasDeps) {
  const router = Router();
  router.get("/", async (req, res) => {
    const raw = req.query as Record<string, unknown>;
    if (isNearby(raw)) {
      const q = parseNearbyQuery(raw);
      const { items, total } = await searchNearby(deps.finder, q);
      res.json({ page: q.page, limit: q.limit, total, data: items.map((n) => view(n.cinema, n.distanceKm)) });
      return;
    }
    const page = Number(raw.page ?? 1);
    const limit = Number(raw.limit ?? DEFAULT_LIMIT);
    if (!Number.isInteger(page) || !Number.isInteger(limit) || page < 1 || limit < 1 || limit > MAX_LIMIT) {
      throw new HttpError(400, "Pagination invalide : page à partir de 1, limit de 1 à 50.");
    }
    const filter = parseFeature(raw) ? { features: parseFeature(raw) } : {};
    const [total, rows] = await Promise.all([
      deps.cinemas().countDocuments(filter),
      deps.cinemas().find(filter, { projection: { _id: 0 } }).sort({ name: 1, slug: 1 }).skip((page - 1) * limit).limit(limit).toArray(),
    ]);
    res.json({ page, limit, total, data: rows.map((c) => view(c)) });
  });
  return router;
}

export const cinemas = () => getDB().collection<Cinema>("cinemas");

export const defaultFinder = (): NearbyFinder => (process.env.GEO_FINDER === "geonear" ? geoNearFinder(cinemas) : boxFinder(cinemas));

export default cinemasRouter({ cinemas, finder: defaultFinder() });
