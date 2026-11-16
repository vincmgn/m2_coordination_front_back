import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boundingBox, EARTH_RADIUS_KM, haversineKm, roundKm } from "../src/geo/distance.js";

const BELLECOUR = [45.7576, 4.8317] as const;
const PART_DIEU = [45.760597, 4.858748] as const;
const REPUBLIQUE = [48.8663, 2.3685] as const;
const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} au lieu de ${expected} ± ${tolerance}`);

describe("Distance (haversine)", () => {
  it("retrouve la valeur publiée par Rosetta Code pour Nashville → Los Angeles", () => {
    near(haversineKm(36.12, -86.67, 33.94, -118.4), 2886.444, 0.001);
  });

  it("reste à moins de 0,5 % de PostGIS sur Bellecour → Part-Dieu et Bellecour → Paris", () => {
    near(haversineKm(...BELLECOUR, ...PART_DIEU), 2.1305, 2.1305 * 0.005);
    near(haversineKm(...BELLECOUR, ...REPUBLIQUE), 392.552, 392.552 * 0.005);
  });

  it("vaut 0 pour un même point et ne dépend pas du sens", () => {
    assert.equal(haversineKm(...BELLECOUR, ...BELLECOUR), 0);
    near(haversineKm(...BELLECOUR, ...PART_DIEU), haversineKm(...PART_DIEU, ...BELLECOUR), 1e-9);
  });

  it("donne la demi-circonférence aux antipodes, sans NaN", () => {
    near(haversineKm(BELLECOUR[0], BELLECOUR[1], -BELLECOUR[0], BELLECOUR[1] - 180), Math.PI * EARTH_RADIUS_KM, 0.001);
  });

  it("inverser lat et lon donne une mauvaise réponse (le piège de la bande dessinée)", () => {
    near(haversineKm(...BELLECOUR, 45.755824, 4.832967), 0.2, 0.05);
    assert.ok(haversineKm(BELLECOUR[1], BELLECOUR[0], 45.755824, 4.832967) > 5000);
  });

  it("arrondit au dixième de kilomètre", () => {
    assert.deepEqual([2.34, 2.26, 0.2206, 4.96].map(roundKm), [2.3, 2.3, 0.2, 5]);
  });
});

describe("Boîte englobante", () => {
  it("est plus large en degrés qu'haute à Lyon : 0,0450° de latitude, 0,0644° de longitude", () => {
    const box = boundingBox(...BELLECOUR, 5);
    near((box.maxLat - box.minLat) / 2, 0.045, 0.0001);
    near((box.maxLon - box.minLon) / 2, 0.0644, 0.0001);
  });

  it("ouvre toutes les longitudes au pôle et à l'antiméridien", () => {
    assert.deepEqual([boundingBox(89.99, 10, 5).maxLat, boundingBox(89.99, 10, 5).minLon, boundingBox(89.99, 10, 5).maxLon], [90, -180, 180]);
    const fiji = boundingBox(-17.8, 179.99, 5);
    assert.deepEqual([fiji.minLon, fiji.maxLon], [-180, 180]);
    assert.ok(fiji.maxLat < 0);
  });
});
