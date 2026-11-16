// Annuaire de démonstration : cinémas fictifs, placés sur des lieux publics géocodés avec la Géoplateforme (IGN)
// le 16/11/2026. 7 autour de Lyon, dont 6 à moins de 5 km de la place Bellecour ; Vénissieux est à environ 8 km.
import type { Collection } from "mongodb";
import type { Cinema } from "./finders.js";

// [slug, nom, adresse, ville, équipements, latitude, longitude] : ordre du contrat, latitude d'abord.
const ROWS: [string, string, string, string, string[], number, number][] = [
  ["charite", "Ciné Charité", "6 rue de la Charité", "Lyon", ["vo", "pmr"], 45.755824, 4.832967],
  ["lafayette", "Le Lafayette", "21 cours Lafayette", "Lyon", ["pmr"], 45.763688, 4.844596],
  ["gratte-ciel", "Ciné Gratte-Ciel", "place du Docteur Lazare Goujon", "Villeurbanne", ["vo", "imax", "pmr"], 45.765944, 4.879525],
  ["part-dieu", "Écran Part-Dieu", "place Charles Béraudier", "Lyon", ["imax", "pmr"], 45.760597, 4.858748],
  ["terreaux", "Les Terreaux", "place des Terreaux", "Lyon", ["vo"], 45.767449, 4.833417],
  ["jean-jaures", "Ciné Jean-Jaurès", "place Jean Jaurès", "Lyon", ["pmr"], 45.739906, 4.839663],
  ["venissieux", "Le Houël", "avenue Marcel Houël", "Vénissieux", ["vo", "pmr"], 45.696717, 4.885538],
  ["republique", "République Cinéma", "18 avenue de la République", "Paris", ["vo", "pmr"], 48.86627, 2.36846],
  ["rennes", "Studio Rennes", "42 rue de Rennes", "Paris", ["vo"], 48.848741, 2.328502],
  ["saint-germain", "Le Saint-Germain", "12 boulevard Saint-Germain", "Paris", ["imax"], 48.849573, 2.354712],
  ["verdun", "Ciné Verdun", "8 cours de Verdun", "Bordeaux", ["pmr"], 44.845538, -0.577462],
];

export const DEMO_CINEMAS: Cinema[] = ROWS.map(([slug, name, address, city, features, latitude, longitude]) => ({
  slug,
  name,
  address,
  city,
  features,
  latitude,
  longitude,
  // Même position en GeoJSON pour l'index 2dsphere : [longitude, latitude]. Toujours écrite avec latitude / longitude.
  location: { type: "Point", coordinates: [longitude, latitude] },
}));

/** Index de la boîte (B-tree composé) et du défi ($geoNear, 2dsphere), puis l'annuaire s'il est vide. */
export async function ensureCinemas(cinemas: Collection<Cinema>) {
  await cinemas.createIndex({ slug: 1 }, { unique: true });
  await cinemas.createIndex({ latitude: 1, longitude: 1 });
  await cinemas.createIndex({ location: "2dsphere" });
  if ((await cinemas.estimatedDocumentCount()) === 0) await cinemas.insertMany(DEMO_CINEMAS.map((c) => ({ ...c })));
}
