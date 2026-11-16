import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { MongoClient, type Collection, type Db } from "mongodb";
import { ensureCinemas } from "../src/geo/cinemas-seed.js";
import { boxFinder, geoNearFinder, type Cinema } from "../src/geo/finders.js";
import { parseNearbyQuery } from "../src/geo/query.js";
import { searchNearby } from "../src/geo/service.js";
import { haversineKm } from "../src/geo/distance.js";

const client = new MongoClient(process.env.MONGO_TEST_URI ?? "mongodb://127.0.0.1:27018", { serverSelectionTimeoutMS: 1500 });
const available = await client.connect().then(() => true, () => false);
let db: Db;
let cinemas: Collection<Cinema>;
const LYON_WITHIN_5_KM = ["Ciné Charité", "Les Terreaux", "Le Lafayette", "Ciné Jean-Jaurès", "Écran Part-Dieu", "Ciné Gratte-Ciel"];
const bellecour = (extra: Record<string, string> = {}) => parseNearbyQuery({ lat: "45.7576", lon: "4.8317", limit: "50", ...extra });

describe("Cinémas autour de Bellecour, sur MongoDB", { skip: !available && "MongoDB injoignable (docker compose up -d mongo)" }, () => {
  before(async () => {
    db = client.db(`geo_test_${process.pid}`);
    cinemas = db.collection<Cinema>("cinemas");
    await ensureCinemas(cinemas);
  });
  after(async () => {
    await db?.dropDatabase();
    await client.close();
  });

  it("boîte : les 6 cinémas lyonnais à moins de 5 km, du plus proche au plus loin", async () => {
    const { items, total } = await searchNearby(boxFinder(() => cinemas), bellecour());
    assert.equal(total, 6);
    assert.deepEqual(items.map((n) => n.cinema.name), LYON_WITHIN_5_KM);
    assert.ok(items.every((n) => n.distanceKm <= 5));
  });

  it("boîte : filtre VO, et personne à (0, 0)", async () => {
    const vo = await searchNearby(boxFinder(() => cinemas), bellecour({ feature: "vo" }));
    assert.deepEqual(vo.items.map((n) => n.cinema.name), ["Ciné Charité", "Les Terreaux", "Ciné Gratte-Ciel"]);
    const nullIsland = await searchNearby(boxFinder(() => cinemas), parseNearbyQuery({ lat: "0", lon: "0", radiusKm: "20" }));
    assert.equal(nullIsland.total, 0);
  });

  it("défi $geoNear : les mêmes six que la boîte, distances à moins de 0,5 % de haversine", async () => {
    const box = await searchNearby(boxFinder(() => cinemas), bellecour());
    const geo = await searchNearby(geoNearFinder(() => cinemas), bellecour());
    assert.deepEqual(geo.items.map((n) => n.cinema.slug), box.items.map((n) => n.cinema.slug));
    for (const n of geo.items) {
      const h = haversineKm(45.7576, 4.8317, n.cinema.latitude, n.cinema.longitude);
      assert.ok(Math.abs(n.distanceKm - h) <= h * 0.005, n.cinema.name);
    }
  });

  it("le plan d'exécution utilise les index : B-tree pour la boîte, 2dsphere pour $geoNear", async () => {
    const boxPlan = JSON.stringify(
      await cinemas.find({ latitude: { $gte: 45.71, $lte: 45.8 }, longitude: { $gte: 4.76, $lte: 4.9 } }).explain("queryPlanner"),
    );
    assert.match(boxPlan, /IXSCAN/);
    assert.match(boxPlan, /latitude_1_longitude_1/);
    const geoPlan = JSON.stringify(
      await cinemas
        .aggregate([{ $geoNear: { near: { type: "Point", coordinates: [4.8317, 45.7576] }, key: "location", distanceField: "m", maxDistance: 5000, spherical: true } }])
        .explain("queryPlanner"),
    );
    assert.match(geoPlan, /GEO_NEAR_2DSPHERE/);
  });
});
