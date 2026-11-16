import type { Collection, Filter } from "mongodb";
import { boundingBox, haversineKm } from "./distance.js";
import type { NearbyQuery } from "./query.js";

export interface Cinema {
  slug: string;
  name: string;
  address: string;
  city: string;
  features: string[];
  latitude: number;
  longitude: number;
  location: { type: "Point"; coordinates: [number, number] };
}

export interface Nearby {
  cinema: Cinema;
  distanceKm: number;
}

export type NearbyFinder = (q: NearbyQuery) => Promise<Nearby[]>;

const featureFilter = (feature: string): Filter<Cinema> => (feature ? { features: feature } : {});

export function boxFinder(cinemas: () => Collection<Cinema>): NearbyFinder {
  return async (q) => {
    const box = boundingBox(q.lat, q.lon, q.radiusKm);
    const inBox = await cinemas()
      .find(
        {
          latitude: { $gte: box.minLat, $lte: box.maxLat },
          longitude: { $gte: box.minLon, $lte: box.maxLon },
          ...featureFilter(q.feature),
        },
        { projection: { _id: 0 } },
      )
      .toArray();
    return inBox
      .map((cinema) => ({ cinema, distanceKm: haversineKm(q.lat, q.lon, cinema.latitude, cinema.longitude) }))
      .filter((n) => n.distanceKm <= q.radiusKm);
  };
}

export function geoNearFinder(cinemas: () => Collection<Cinema>): NearbyFinder {
  return async (q) => {
    const rows = await cinemas()
      .aggregate<Cinema & { meters: number }>([
        {
          $geoNear: {
            near: { type: "Point", coordinates: [q.lon, q.lat] },
            key: "location",
            distanceField: "meters",
            maxDistance: q.radiusKm * 1000,
            spherical: true,
            query: featureFilter(q.feature),
          },
        },
        { $project: { _id: 0 } },
      ])
      .toArray();
    return rows.map(({ meters, ...cinema }) => ({ cinema, distanceKm: meters / 1000 }));
  };
}
