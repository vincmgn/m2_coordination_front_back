// Règles métier du billet : droits avant fabrication, 404 / 409, nom de fichier, heure de Paris.
// Fuseau du processus volontairement différent de Paris : le résultat ne doit pas en dépendre.
process.env.TZ = "America/New_York";

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { HttpError } from "../src/http-error.js";
import { formatInstant } from "../src/ticket/formats.js";
import { buildTicket, CANCELLED, NOT_FOUND, type TicketStore } from "../src/ticket/service.js";
import type { TicketBooking, TicketView } from "../src/ticket/view.js";

const OWNER = "65000000000000000000000a";
const OTHER = "65000000000000000000000b";
const BOOKING = "6560f1a2b3c4d5e6f7a8b9c0";
const CANCELLED_BOOKING = "6560f1a2b3c4d5e6f7a8b9c1";

const booking: TicketBooking = {
  bookingId: BOOKING,
  screeningId: "573a1390f29313caabcd42e8-20261124-0930",
  seats: ["E5"],
  name: "Hélène Durand",
  createdAt: new Date("2026-11-21T08:30:00Z"),
};

const store: TicketStore = {
  findBooking: async (userId, id) => (userId === OWNER && id === BOOKING ? booking : null),
  isCancelled: async (userId, id) => userId === OWNER && id === CANCELLED_BOOKING,
  findMovie: async () => ({ title: "Amélie", year: 2001 }),
};

const fakeRender = () => mock.fn(async (_v: TicketView) => Buffer.from("%PDF-1.7 faux"));
const status = (code: number, message: string) => (e: unknown) => e instanceof HttpError && e.status === code && e.message === message;

describe("buildTicket : droits", () => {
  it("réservation d'un autre compte : 404 (pas 403) et aucun PDF fabriqué", async () => {
    const render = fakeRender();
    await assert.rejects(buildTicket(OTHER, BOOKING, store, render), status(404, NOT_FOUND));
    assert.equal(render.mock.callCount(), 0);
  });

  it("réservation annulée : 409 et aucun PDF fabriqué", async () => {
    const render = fakeRender();
    await assert.rejects(buildTicket(OWNER, CANCELLED_BOOKING, store, render), status(409, CANCELLED));
    assert.equal(render.mock.callCount(), 0);
  });

  it("identifiant mal formé : 404, comme une réservation inconnue", async () => {
    const render = fakeRender();
    await assert.rejects(buildTicket(OWNER, "../etc/passwd", store, render), status(404, NOT_FOUND));
    assert.equal(render.mock.callCount(), 0);
  });

  it("sa réservation : PDF fabriqué, nom de fichier sans nom, titre ni date", async () => {
    const render = fakeRender();
    const ticket = await buildTicket(OWNER, BOOKING.toUpperCase(), store, render);
    assert.equal(ticket.filename, `billet-${BOOKING}.pdf`);
    assert.equal(render.mock.callCount(), 1);
    const view = render.mock.calls[0]!.arguments[0];
    assert.equal(view.spectatorName, "Hélène Durand");
    assert.equal(view.day, "mardi 24 novembre 2026");
    assert.equal(view.time, "9 h 30");
  });
});

describe("heure de Paris", () => {
  it("hiver (UTC+1) : 08:30Z → 9 h 30", () => {
    assert.equal(formatInstant(new Date("2026-11-24T08:30:00Z")), "24 novembre 2026 à 9 h 30");
  });

  it("été (UTC+2) : 07:30Z → 9 h 30", () => {
    assert.equal(formatInstant(new Date("2026-07-07T07:30:00Z")), "7 juillet 2026 à 9 h 30");
  });

  it("le jour du changement d'heure : 29 mars 2026, 00:30Z → 1 h 30, 01:30Z → 3 h 30", () => {
    assert.equal(formatInstant(new Date("2026-03-29T00:30:00Z")), "29 mars 2026 à 1 h 30");
    assert.equal(formatInstant(new Date("2026-03-29T01:30:00Z")), "29 mars 2026 à 3 h 30");
  });
});
