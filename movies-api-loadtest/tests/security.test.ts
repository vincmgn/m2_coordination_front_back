// Défenses transverses : en-têtes, CSRF, taille et type du corps, limites de fréquence, jetons d'annulation, nettoyage.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import express, { type NextFunction, type Request, type Response } from "express";
import { HttpError } from "../src/http-error.js";
import { rateLimiter } from "../src/rate-limit.js";
import { cancelToken, checkCancelToken } from "../src/secret.js";
import { cleanText, csrfGuard, noStoreByDefault, securityHeaders } from "../src/security.js";

let base = "";
let close = () => {};

before(async () => {
  const app = express();
  app.use(securityHeaders, noStoreByDefault, csrfGuard, express.json({ limit: "16kb" }));
  app.get("/ping", (_req, res) => res.json({ ok: true }));
  app.post("/echo", (req, res) => res.json(req.body ?? null));
  app.delete("/thing", (_req, res) => res.status(204).end());
  app.use((err: HttpError & { type?: string }, _req: Request, res: Response, _next: NextFunction) =>
    res.status(err.type === "entity.too.large" ? 413 : (err.status ?? 500)).json({ error: err.message }),
  );
  const server = app.listen(0);
  await new Promise((ok) => server.once("listening", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
after(() => close());

const json = { "Content-Type": "application/json" };

describe("en-têtes de sécurité", () => {
  it("CSP « rien », nosniff, pas d'iframe, pas de cache", async () => {
    const r = await fetch(`${base}/ping`);
    assert.match(r.headers.get("content-security-policy") ?? "", /default-src 'none'.*frame-ancestors 'none'/);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.equal(r.headers.get("referrer-policy"), "no-referrer");
    assert.equal(r.headers.get("cache-control"), "no-store");
  });
});

describe("CSRF", () => {
  it("même origine : accepté", async () => {
    const host = new URL(base).host;
    const r = await fetch(`${base}/echo`, { method: "POST", headers: { ...json, Origin: `http://${host}`, "Sec-Fetch-Site": "same-origin" }, body: '{"a":1}' });
    assert.equal(r.status, 200);
  });

  it("client hors navigateur (ni Origin ni Sec-Fetch-Site) : accepté", async () => {
    assert.equal((await fetch(`${base}/echo`, { method: "POST", headers: json, body: "{}" })).status, 200);
  });

  it("autre site ou autre port du même site : 403", async () => {
    for (const site of ["cross-site", "same-site"]) {
      const r = await fetch(`${base}/thing`, { method: "DELETE", headers: { "Sec-Fetch-Site": site } });
      assert.equal(r.status, 403, site);
    }
  });

  it("Origin d'un autre hôte, ou « null » : 403", async () => {
    for (const origin of ["http://localhost:16686", "https://evil.example", "null"]) {
      const r = await fetch(`${base}/echo`, { method: "POST", headers: { ...json, Origin: origin }, body: "{}" });
      assert.equal(r.status, 403, origin);
    }
  });

  it("corps d'un formulaire (text/plain, urlencoded) : 415", async () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const r = await fetch(`${base}/echo`, { method: "POST", headers: { "Content-Type": type }, body: '{"a":1}' });
      assert.equal(r.status, 415, type);
    }
  });

  it("corps trop gros : 413", async () => {
    const r = await fetch(`${base}/echo`, { method: "POST", headers: json, body: JSON.stringify({ x: "a".repeat(20_000) }) });
    assert.equal(r.status, 413);
  });
});

describe("limite de fréquence", () => {
  it("max actions par fenêtre et par clé, puis un délai d'attente ; les autres clés ne sont pas gênées", () => {
    const l = rateLimiter({ max: 3, windowMs: 60_000 });
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) assert.equal(l.take("ip-a", t0 + i), 0);
    assert.equal(l.take("ip-a", t0 + 10), 60);
    assert.equal(l.take("ip-b", t0 + 10), 0);
    assert.equal(l.take("ip-a", t0 + 60_001), 0); // la fenêtre a glissé
  });
});

describe("jeton d'annulation (réservation sans compte)", () => {
  const id = "6560f1a2b3c4d5e6f7a8b9c0";
  it("propre à chaque réservation, vérifié en temps constant", () => {
    const t = cancelToken(id);
    assert.match(t, /^[0-9a-f]{32}$/);
    assert.ok(checkCancelToken(id, t));
    assert.notEqual(cancelToken("6560f1a2b3c4d5e6f7a8b9c1"), t);
  });
  it("refuse un jeton absent, faux ou d'une autre réservation", () => {
    for (const bad of [undefined, "", "x", "0".repeat(32), cancelToken("6560f1a2b3c4d5e6f7a8b9c1"), cancelToken(id).toUpperCase()]) {
      assert.equal(checkCancelToken(id, bad), false, String(bad));
    }
  });
});

describe("nettoyage des textes saisis", () => {
  it("retire contrôles, caractères de direction et séparateurs de ligne ; espaces normalisés", () => {
    assert.equal(cleanText("  Jean‮fdp.exe  "), "Jeanfdp.exe");
    assert.equal(cleanText("Hélène\u0000 \t Durand "), "Hélène Durand");
    assert.equal(cleanText("A​nne"), "Anne");
  });
});
