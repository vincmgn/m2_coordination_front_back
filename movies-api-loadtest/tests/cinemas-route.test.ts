// Contrat HTTP de GET /cinemas?lat=…&lon=… sur un vrai serveur Express (port libre), sans base :
// le faux stockage renvoie « la boîte », le vrai boxFinder mesure et trie.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import express, { type NextFunction, type Request, type Response } from "express";
import type { Collection } from "mongodb";
import { boxFinder, type Cinema } from "../src/geo/finders.js";
import { HttpError } from "../src/http-error.js";
import { cinemasRouter } from "../src/routes/cinemas.js";

const cinema = (slug: string, name: string, latitude: number, longitude: number): Cinema => ({
  slug, name, address: "-", city: "Lyon", features: slug === "vidal" ? ["vo"] : [], latitude, longitude,
  location: { type: "Point", coordinates: [longitude, latitude] },
});

// Ce que MongoDB renverrait pour la boîte de 5 km autour de Bellecour, dans le désordre.
const BOX = [
  cinema("vidal", "Ciné Gratte-Ciel", 45.765944, 4.879525), // 3,8 km
  cinema("charite", "Ciné Charité", 45.755824, 4.832967), // 0,2 km
  cinema("zoe", "Égal Zoé", 45.767449, 4.833417), // 1,1 km, ex aequo
  cinema("coin", "Le Coin", 45.7976, 4.8897), // dans la boîte, à 6,3 km : hors du cercle
  cinema("anne", "Égal Anne", 45.767449, 4.833417), // 1,1 km, ex aequo
  cinema("lafayette", "Le Lafayette", 45.763688, 4.844596), // 1,2 km
];

const filters: unknown[] = [];
const fake = {
  find: (filter: unknown) => {
    filters.push(filter);
    return { toArray: async () => BOX, sort: () => ({ skip: () => ({ limit: () => ({ toArray: async () => [] }) }) }) };
  },
  countDocuments: async () => 0,
} as unknown as Collection<Cinema>;

let base = "";
let close = () => {};

before(async () => {
  const app = express();
  app.use("/cinemas", cinemasRouter({ cinemas: () => fake, finder: boxFinder(() => fake) }));
  app.use((err: HttpError, _req: Request, res: Response, _next: NextFunction) => res.status(err.status ?? 500).json({ error: err.message }));
  const server = app.listen(0);
  await new Promise((ok) => server.once("listening", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/cinemas`;
  close = () => server.close();
});
after(() => close());

const get = async (query: string) => {
  const res = await fetch(`${base}?${query}`);
  return { status: res.status, text: await res.clone().text(), body: (await res.json()) as { total: number; data: { name: string; distanceKm: number }[]; error?: string } };
};
const BELLECOUR = "lat=45.7576&lon=4.8317";

describe("GET /cinemas autour de Bellecour", () => {
  it("écarte le coin de la boîte et trie sur la distance exacte", async () => {
    const { status, body } = await get(`${BELLECOUR}&radiusKm=5`);
    assert.equal(status, 200);
    assert.equal(body.total, 5); // le coin est exclu
    assert.equal(body.data[0].name, "Ciné Charité");
    assert.equal(body.data[0].distanceKm, 0.2);
    assert.ok(body.data.every((c) => c.distanceKm <= 5));
  });

  it("départage les ex aequo par le nom", async () => {
    const { body } = await get(BELLECOUR);
    assert.deepEqual(body.data.map((c) => c.name), ["Ciné Charité", "Égal Anne", "Égal Zoé", "Le Lafayette", "Ciné Gratte-Ciel"]);
  });

  it("découpe la page après le tri : personne n'apparaît deux fois", async () => {
    assert.deepEqual((await get(`${BELLECOUR}&page=2&limit=2`)).body.data.map((c) => c.name), ["Égal Zoé", "Le Lafayette"]);
    assert.deepEqual((await get(`${BELLECOUR}&page=3&limit=2`)).body.data.map((c) => c.name), ["Ciné Gratte-Ciel"]);
    assert.deepEqual((await get(`${BELLECOUR}&page=9&limit=2`)).body.data, []);
  });

  it("prend 5 km par défaut et transmet le filtre d'équipement à la base", async () => {
    filters.length = 0;
    await get(`${BELLECOUR}&feature=vo`);
    const f = filters[0] as { latitude: { $gte: number; $lte: number }; features: string };
    assert.ok(Math.abs((f.latitude.$lte - f.latitude.$gte) / 2 - 0.045) < 0.0001);
    assert.equal(f.features, "vo");
  });

  it("ne renvoie jamais la position reçue", async () => {
    const { text } = await get(BELLECOUR);
    assert.ok(!text.includes("45.7576") && !text.includes("4.8317"), text);
  });
});

describe("GET /cinemas : refus en 400, avec une phrase", () => {
  const cases: [string, string][] = [
    ["lat=95&lon=4.8", "Latitude invalide : entre -90 et 90 degrés."],
    ["lat=45.75", "Indiquez lat et lon ensemble."],
    ["radiusKm=5", "Indiquez lat et lon ensemble."],
    ["lat=abc&lon=4.8", "Paramètre invalide : lat."],
    ["lat=NaN&lon=4.8", "Latitude invalide : entre -90 et 90 degrés."],
    ["lat=45.75&lon=Infinity", "Longitude invalide : entre -180 et 180 degrés."],
    ["lat=45.75&lon=200", "Longitude invalide : entre -180 et 180 degrés."],
    [`${BELLECOUR}&radiusKm=30`, "Rayon invalide : plus de 0 et au plus 20 km."],
    [`${BELLECOUR}&radiusKm=0`, "Rayon invalide : plus de 0 et au plus 20 km."],
    [`${BELLECOUR}&limit=51`, "Pagination invalide : page à partir de 1, limit de 1 à 50."],
    [`${BELLECOUR}&page=0`, "Pagination invalide : page à partir de 1, limit de 1 à 50."],
    [`${BELLECOUR}&feature=4dx`, "Équipement invalide : vo, imax ou pmr."],
  ];
  for (const [query, error] of cases) {
    it(`${query} → ${error}`, async () => {
      filters.length = 0;
      const { status, body, text } = await get(query);
      assert.equal(status, 400);
      assert.equal(body.error, error);
      assert.ok(!text.includes("abc"), "la valeur reçue n'est pas recopiée");
      assert.equal(filters.length, 0, "refusé avant toute requête MongoDB");
    });
  }
});
