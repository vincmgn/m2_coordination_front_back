import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import express, { type NextFunction, type Request, type Response } from "express";
import { HttpError } from "../src/http-error.js";
import { TOO_MANY, ticketsRouter } from "../src/routes/tickets.js";
import type { TicketStore } from "../src/ticket/service.js";

const OWNER = "65000000000000000000000a";
const BOOKING = "6560f1a2b3c4d5e6f7a8b9c0";
const CANCELLED_BOOKING = "6560f1a2b3c4d5e6f7a8b9c1";

const store: TicketStore = {
  findBooking: async (userId, id) =>
    userId === OWNER && id === BOOKING
      ? { bookingId: BOOKING, screeningId: "573a1390f29313caabcd42e8-20261124-0930", seats: ["E5"], name: "Hélène Durand", createdAt: new Date() }
      : null,
  isCancelled: async (userId, id) => userId === OWNER && id === CANCELLED_BOOKING,
  findMovie: async () => ({ title: "Amélie" }),
};

let base = "";
let close = () => {};

before(async () => {
  const app = express();
  app.use(
    "/screenings",
    ticketsRouter({
      store,
      limit: { max: 6, windowMs: 60_000 },
      userId: async (req) => {
        const id = req.get("X-Test-User");
        if (!id) throw new HttpError(401, "Connexion requise");
        return id;
      },
    }),
  );
  app.use((err: HttpError, _req: Request, res: Response, _next: NextFunction) => res.status(err.status ?? 500).json({ error: err.message }));
  const server = app.listen(0);
  await new Promise((ok) => server.once("listening", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/screenings/mine`;
  close = () => server.close();
});

after(() => close());

const get = (path: string, user: string | null = OWNER) => fetch(`${base}${path}`, { headers: user ? { "X-Test-User": user } : {} });

describe("GET /screenings/mine/:bookingId/ticket.pdf", () => {
  it("200 inline : les quatre en-têtes du contrat", async () => {
    const r = await get(`/${BOOKING}/ticket.pdf`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/pdf");
    assert.equal(r.headers.get("content-disposition"), `inline; filename="billet-${BOOKING}.pdf"`);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    const body = Buffer.from(await r.arrayBuffer());
    assert.equal(r.headers.get("content-length"), String(body.length));
    assert.equal(body.subarray(0, 5).toString("latin1"), "%PDF-");
  });

  it("download=true : attachment, même nom", async () => {
    const r = await get(`/${BOOKING}/ticket.pdf?download=true`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-disposition"), `attachment; filename="billet-${BOOKING}.pdf"`);
  });

  it("401 sans session, en JSON et sans cache", async () => {
    const r = await get(`/${BOOKING}/ticket.pdf`, null);
    assert.equal(r.status, 401);
    assert.match(r.headers.get("content-type") ?? "", /^application\/json/);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.deepEqual(await r.json(), { error: "Connexion requise" });
  });

  it("404 pour un autre compte, 409 pour une réservation annulée", async () => {
    const other = await get(`/${BOOKING}/ticket.pdf`, "65000000000000000000000b");
    assert.equal(other.status, 404);
    assert.deepEqual(await other.json(), { error: "Réservation introuvable" });
    const cancelled = await get(`/${CANCELLED_BOOKING}/ticket.pdf`);
    assert.equal(cancelled.status, 409);
    assert.deepEqual(await cancelled.json(), { error: "Cette réservation a été annulée : elle n'a plus de billet." });
  });

  it("429 au-delà de la limite par compte, avec Retry-After ; les autres comptes ne sont pas gênés", async () => {
    const busy = "65000000000000000000000c";
    for (let i = 0; i < 6; i++) assert.equal((await get(`/${BOOKING}/ticket.pdf`, busy)).status, 404);
    const r = await get(`/${BOOKING}/ticket.pdf`, busy);
    assert.equal(r.status, 429);
    const retry = Number(r.headers.get("retry-after"));
    assert.ok(retry > 0 && retry <= 60, `Retry-After : ${retry}`);
    assert.deepEqual(await r.json(), { error: TOO_MANY });
    assert.equal((await get(`/${BOOKING}/ticket.pdf`)).status, 200);
  });
});
