// Trouver les cinémas dans le cercle. Deux façons, mêmes résultats (test à l'appui) :
//   boxFinder    défaut : MongoDB filtre la boîte (index { latitude, longitude }), le code mesure et écarte les coins
//   geoNearFinder défi (GEO_FINDER=geonear) : $geoNear sur l'index 2dsphere, l'équivalent de ST_DWithin dans PostGIS
import type { Collection, Filter } from "mongodb";
import { boundingBox, haversineKm } from "./distance.js";
import type { NearbyQuery } from "./query.js";

/** Cinéma (adresse publique). Position en double : latitude / longitude pour la boîte, location en GeoJSON [lon, lat]. */
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

/** Un cinéma et sa distance exacte (non arrondie) au centre, en km. */
export interface Nearby {
  cinema: Cinema;
  distanceKm: number;
}

/** Trouve les cinémas dans le cercle, sans ordre garanti : le tri et la page sont faits par searchNearby. */
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
      .filter((n) => n.distanceKm <= q.radiusKm); // coins de la boîte : hors du cercle
  };
}

export function geoNearFinder(cinemas: () => Collection<Cinema>): NearbyFinder {
  return async (q) => {
    const rows = await cinemas()
      .aggregate<Cinema & { meters: number }>([
        {
          $geoNear: {
            near: { type: "Point", coordinates: [q.lon, q.lat] }, // GeoJSON : longitude D'ABORD
            key: "location",
            distanceField: "meters", // sphère de 6 378,1 km : mètres
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
