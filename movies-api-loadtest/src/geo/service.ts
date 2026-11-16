import type { Nearby, NearbyFinder } from "./finders.js";
import type { NearbyQuery } from "./query.js";

export const ORDER = (a: Nearby, b: Nearby) =>
  a.distanceKm - b.distanceKm || a.cinema.name.localeCompare(b.cinema.name, "fr") || a.cinema.slug.localeCompare(b.cinema.slug);

export async function searchNearby(find: NearbyFinder, q: NearbyQuery) {
  const all = (await find(q)).sort(ORDER);
  const from = (q.page - 1) * q.limit;
  return { items: all.slice(from, from + q.limit), total: all.length };
}
