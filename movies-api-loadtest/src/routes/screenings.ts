import { EventEmitter } from "node:events";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { Router, type Response } from "express";
import { MongoBulkWriteError, ObjectId } from "mongodb";
import { getDB } from "../db.js";
import { HttpError } from "../http-error.js";
import { recordConversion } from "./ab.js";
import { currentUser, requireUser } from "./auth.js";
import { sendSms, type SmsStatus } from "../sms.js";
import { TP_TICKETS } from "../tp.js";

// Réservation de places de cinéma (équivalent des créneaux : un siège d'une séance = une place réservable une seule fois).
//
// Les séances ne sont pas stockées : chaque film a des séances calculées (3 horaires par jour sur 3 jours)
// dans une salle fixe. Seules les réservations sont en base, avec un index unique (séance, siège) :
// MongoDB refuse la deuxième réservation d'un même siège, même si deux clics arrivent en même temps.
//
// Temps réel : GET /screenings/:id/events est un flux SSE (Server-Sent Events). Contrat (cf. cours SSE) :
//   ready         à chaque abonnement, { action: "reload" } : le front relit GET /screenings/:id
//   seat-updated  après une écriture réussie, { screeningId, seats, status: BOOKED | AVAILABLE } : le front relit
//   viewers       nombre de navigateurs abonnés à la séance (information publique, sans identité)
//   : keepalive   commentaire toutes les 15 s, sans action métier
// Le flux ne contient ni nom ni bookingId : seule la réponse du POST confirme une réservation personnelle.
// Les événements passent par un EventEmitter en mémoire : suffisant avec une seule instance de l'API
// (avec plusieurs, il faudrait un bus partagé). Pas de journal : après une coupure, le front relit l'état actuel.

const ROWS = "ABCDEFGH".split("");
const SEATS_PER_ROW = 12;
const CAPACITY = ROWS.length * SEATS_PER_ROW;
const TIMES = ["14:00", "17:30", "21:00"];
const DAYS = 3;
const MAX_SEATS_PER_BOOKING = 10;
const TIME_ZONE = "Europe/Paris";

interface Reservation {
  screeningId: string;
  seat: string;
  name: string;
  email: string;
  phone: string;
  bookingId: ObjectId;
  requestId?: string;
  userId?: ObjectId; // compte connecté au moment de la réservation (facultatif)
  createdAt: Date;
  smsStatus?: SmsStatus; // résultat du SMS de confirmation
  smsAt?: Date;
}

const router = Router();
const reservations = () => getDB().collection<Reservation>("reservations");
const movies = () => getDB().collection("movies");
// Traceur des spans métier. Sans instrumentation chargée, l'API OpenTelemetry ne fait rien (aucun coût).
const tracer = trace.getTracer("movies-api");

export async function ensureScreeningIndexes() {
  await reservations().createIndex({ screeningId: 1, seat: 1 }, { unique: true });
  await reservations().createIndex({ screeningId: 1, bookingId: 1 });
  await reservations().createIndex({ requestId: 1 }, { partialFilterExpression: { requestId: { $exists: true } } });
  await reservations().createIndex({ userId: 1 }, { partialFilterExpression: { userId: { $exists: true } } });
}

async function findByRequest(screeningId: string, requestId: string) {
  const rows = await reservations().find({ screeningId, requestId }).toArray();
  if (!rows.length) return null;
  return { bookingId: rows[0]!.bookingId, screeningId, seats: rows.map((r) => r.seat), name: rows[0]!.name };
}

// --- Séances calculées -------------------------------------------------------------------------

// Date et heure actuelles à Paris, au format « 2026-10-08 » et « 2026-10-08T14:32 » (comparables comme du texte).
function parisNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, dateTime: `${date}T${parts.hour}:${parts.minute}` };
}

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// Identifiant de séance : <id du film>-<AAAAMMJJ>-<HHMM>, ex. 573a1390f29313caabcd42e8-20261009-1730.
const screeningId = (movieId: string, date: string, time: string) => `${movieId}-${date.replaceAll("-", "")}-${time.replace(":", "")}`;

function upcomingScreenings(movieId: string) {
  const now = parisNow();
  const list = [];
  for (let day = 0; day < DAYS; day++) {
    const date = addDays(now.date, day);
    for (const time of TIMES) {
      if (`${date}T${time}` > now.dateTime) list.push({ id: screeningId(movieId, date, time), date, time });
    }
  }
  return list;
}

// Vérifie qu'un identifiant correspond à une séance à venir d'un film existant.
async function findScreening(id: string) {
  const match = id.match(/^([0-9a-f]{24})-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/i);
  if (!match) throw new HttpError(400, `Identifiant de séance invalide : "${id}"`);
  const [, movieId, y, m, d, hh, mm] = match;
  const screening = upcomingScreenings(movieId.toLowerCase()).find((s) => s.id === id.toLowerCase());
  if (!screening) throw new HttpError(404, `Séance introuvable ou déjà passée : ${y}-${m}-${d} ${hh}:${mm}`);
  const movie = await movies().findOne({ _id: new ObjectId(movieId) }, { projection: { title: 1, year: 1, poster: 1, runtime: 1 } });
  if (!movie) throw new HttpError(404, "Film introuvable");
  return { ...screening, movie };
}

const takenSeats = async (id: string) =>
  (
    await reservations()
      .find({ screeningId: id }, { projection: { seat: 1 } })
      .toArray()
  ).map((r) => r.seat);

function parseSeats(value: unknown): string[] {
  const seatPattern = new RegExp(`^[${ROWS.join("")}]([1-9]|1[0-${SEATS_PER_ROW - 10}])$`);
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SEATS_PER_BOOKING) {
    throw new HttpError(400, `Le champ "seats" doit contenir de 1 à ${MAX_SEATS_PER_BOOKING} sièges (ex. ["C7", "C8"])`);
  }
  const seats = value.map((s) => (typeof s === "string" ? s.trim().toUpperCase() : ""));
  const invalid = seats.filter((s) => !seatPattern.test(s));
  if (invalid.length) throw new HttpError(400, `Sièges invalides : ${invalid.join(", ") || "(vide)"}`);
  if (new Set(seats).size !== seats.length) throw new HttpError(400, "Un même siège est demandé deux fois");
  return seats;
}

// --- Temps réel (SSE) --------------------------------------------------------------------------

type ScreeningEvent = { type: "seat-updated"; screeningId: string; seats: string[]; status: "BOOKED" | "AVAILABLE" } | { type: "viewers"; count: number };

const bus = new EventEmitter();
bus.setMaxListeners(0); // un écouteur par navigateur connecté : pas de limite artificielle
const viewers = new Map<string, number>();

const publish = (id: string, event: ScreeningEvent) => bus.emit(id, event);

// Identifiant d'événement local au processus : sert à observer le flux, pas à rejouer un historique.
let sequence = 0;

function sendEvent(res: Response, event: string, data: unknown) {
  // Une connexion fermée ne doit pas faire échouer l'opération qui a déclenché l'envoi.
  if (res.writableEnded || res.destroyed) return;
  res.write(`id: ${++sequence}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// --- Routes ------------------------------------------------------------------------------------

// GET /screenings?movieId=… : séances à venir d'un film, avec le nombre de places libres.
router.get("/", async (req, res) => {
  const movieId = typeof req.query.movieId === "string" ? req.query.movieId.toLowerCase() : "";
  if (!/^[0-9a-f]{24}$/.test(movieId)) throw new HttpError(400, 'Paramètre "movieId" invalide (24 caractères hexadécimaux)');
  if (!(await movies().countDocuments({ _id: new ObjectId(movieId) }, { limit: 1 }))) throw new HttpError(404, "Film introuvable");

  const list = upcomingScreenings(movieId);
  const counts = await reservations()
    .aggregate<{ _id: string; taken: number }>([{ $match: { screeningId: { $in: list.map((s) => s.id) } } }, { $group: { _id: "$screeningId", taken: { $sum: 1 } } }])
    .toArray();
  const taken = new Map(counts.map((c) => [c._id, c.taken]));
  res.json(list.map((s) => ({ ...s, capacity: CAPACITY, available: CAPACITY - (taken.get(s.id) ?? 0) })));
});

type MovieCard = { _id: ObjectId; title?: string; poster?: string };

// Titres et affiches des films réservés, en une seule requête ($in).
async function titlesAtOnce(bookings: { screeningId: string }[]) {
  const movieIds = [...new Set(bookings.map((b) => b.screeningId.slice(0, 24)))].map((id) => new ObjectId(id));
  const found = await movies().find<MovieCard>({ _id: { $in: movieIds } }, { projection: { title: 1, poster: 1 } }).toArray();
  return new Map(found.map((m) => [String(m._id), m]));
}

// TP OpenTelemetry, ticket T2 : une requête par réservation (N+1). Actif avec TP_TICKETS=1.
async function titlesOneByOne(bookings: { screeningId: string }[]) {
  const titles = new Map<string, MovieCard>();
  for (const b of bookings) {
    const id = b.screeningId.slice(0, 24);
    const movie = await movies().findOne<MovieCard>({ _id: new ObjectId(id) }, { projection: { title: 1, poster: 1 } });
    if (movie) titles.set(id, movie);
  }
  return titles;
}

// GET /screenings/mine : réservations du compte connecté (« Mes séances »), passées comprises, de la plus proche à la plus ancienne.
// Déclarée avant /:id, sinon « mine » serait pris pour un identifiant de séance.
router.get("/mine", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const user = await requireUser(req);
  const bookings = await reservations()
    .aggregate<{ _id: ObjectId; screeningId: string; seats: string[]; name: string; createdAt: Date }>([
      { $match: { userId: user._id } },
      { $group: { _id: "$bookingId", screeningId: { $first: "$screeningId" }, seats: { $push: "$seat" }, name: { $first: "$name" }, createdAt: { $first: "$createdAt" } } },
    ])
    .toArray();

  const titles = TP_TICKETS ? await titlesOneByOne(bookings) : await titlesAtOnce(bookings);
  const now = parisNow().dateTime;
  const list = bookings.map((b) => {
    const [, movieId, y, m, d, hh, mm] = b.screeningId.match(/^([0-9a-f]{24})-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/)!;
    const date = `${y}-${m}-${d}`;
    const time = `${hh}:${mm}`;
    const movie = titles.get(movieId!);
    return {
      bookingId: b._id,
      screeningId: b.screeningId,
      date,
      time,
      upcoming: `${date}T${time}` > now,
      movie: { _id: movieId, title: movie?.title ?? "Film supprimé", poster: movie?.poster },
      seats: b.seats.sort((a, z) => a[0]!.localeCompare(z[0]!) || Number(a.slice(1)) - Number(z.slice(1))),
      name: b.name,
    };
  });
  // À venir d'abord (la plus proche en premier), puis passées (la plus récente en premier).
  list.sort((a, b) => Number(b.upcoming) - Number(a.upcoming) || (a.upcoming ? 1 : -1) * `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  res.json(list);
});

// --- Historique d'une réservation ------------------------------------------------------------

type HistoryType = "RESERVEE" | "SMS_ENVOYE" | "SMS_ECHEC" | "SEANCE_PASSEE";

const LABELS: Partial<Record<HistoryType, string>> = {
  RESERVEE: "Réservation enregistrée : {places}",
  SMS_ENVOYE: "SMS de confirmation envoyé",
  // TP OpenTelemetry, ticket T3 : avec TP_TICKETS=1, le libellé de l'échec SMS manque.
  ...(TP_TICKETS ? {} : { SMS_ECHEC: "SMS de confirmation non remis (opérateur indisponible)" }),
  SEANCE_PASSEE: "Séance passée",
};

function historyLabel(type: HistoryType, seats: string[]) {
  return LABELS[type]!.replace("{places}", seats.join(", "));
}

// GET /screenings/mine/:bookingId/history : étapes d'une réservation du compte connecté, de la plus ancienne à la plus récente.
router.get("/mine/:bookingId/history", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const user = await requireUser(req);
  if (!/^[0-9a-f]{24}$/i.test(req.params.bookingId)) throw new HttpError(400, "Identifiant de réservation invalide");
  const rows = await reservations()
    .find({ userId: user._id, bookingId: new ObjectId(req.params.bookingId) })
    .toArray();
  if (!rows.length) throw new HttpError(404, "Réservation introuvable");

  const first = rows[0]!;
  const seats = rows.map((r) => r.seat).sort();
  const events: { type: HistoryType; at: string }[] = [{ type: "RESERVEE", at: first.createdAt.toISOString() }];
  if (first.smsStatus) events.push({ type: first.smsStatus === "SENT" ? "SMS_ENVOYE" : "SMS_ECHEC", at: (first.smsAt ?? first.createdAt).toISOString() });
  const [, , y, m, d, hh, mm] = first.screeningId.match(/^([0-9a-f]{24})-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/)!;
  if (`${y}-${m}-${d}T${hh}:${mm}` <= parisNow().dateTime) events.push({ type: "SEANCE_PASSEE", at: `${y}-${m}-${d}T${hh}:${mm}` });

  res.json({ bookingId: first.bookingId, events: events.map((e) => ({ ...e, label: historyLabel(e.type, seats) })) });
});

// GET /screenings/:id : la séance, le plan de salle et les sièges déjà réservés.
router.get("/:id", async (req, res) => {
  const screening = await findScreening(req.params.id);
  res.json({
    ...screening,
    room: { rows: ROWS, seatsPerRow: SEATS_PER_ROW, capacity: CAPACITY },
    taken: await takenSeats(screening.id),
  });
});

// GET /screenings/:id/events : flux SSE de la séance.
router.get("/:id/events", async (req, res) => {
  const screening = await findScreening(req.params.id);
  const id = screening.id;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // désactive la mise en mémoire tampon d'un éventuel proxy (nginx)
  });
  res.write("retry: 2000\n\n"); // le navigateur se reconnecte seul après 2 s en cas de coupure

  // À chaque abonnement (donc aussi après une reconnexion) : le front relit l'état actuel.
  sendEvent(res, "ready", { action: "reload" });

  const onEvent = (event: ScreeningEvent) => sendEvent(res, event.type, event);
  bus.on(id, onEvent);
  viewers.set(id, (viewers.get(id) ?? 0) + 1);
  publish(id, { type: "viewers", count: viewers.get(id)! });

  // Heartbeat : commentaire SSE toutes les 15 s, garde la connexion ouverte à travers les proxys.
  const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    bus.off(id, onEvent);
    const count = (viewers.get(id) ?? 1) - 1;
    if (count > 0) viewers.set(id, count);
    else viewers.delete(id);
    publish(id, { type: "viewers", count });
  });
});

// POST /screenings/:id/reservations { seats: ["C7", "C8"], name: "Alice", email: "alice@example.com", phone: "06 12 34 56 78" }
router.post("/:id/reservations", async (req, res) => {
  const screening = await findScreening(req.params.id);
  const seats = parseSeats(req.body?.seats);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name || name.length > 60) throw new HttpError(400, 'Le champ "name" est requis (60 caractères maximum)');
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Le champ "email" est requis et doit être valide');
  // Téléphone gardé sans espaces, points ni tirets : 8 à 15 chiffres, « + » initial facultatif.
  const phone = typeof req.body?.phone === "string" ? req.body.phone.replace(/[\s.()-]/g, "") : "";
  if (!/^\+?\d{8,15}$/.test(phone)) throw new HttpError(400, 'Le champ "phone" est requis (8 à 15 chiffres, ex. 06 12 34 56 78)');
  // Facultatif : avec requestId, renvoyer la même demande ne réserve jamais deux fois (idempotence).
  const requestId = req.body?.requestId;
  if (requestId !== undefined && (typeof requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(requestId))) {
    throw new HttpError(400, 'Le champ "requestId" doit être un UUID');
  }
  if (requestId) {
    const existing = await findByRequest(screening.id, requestId);
    if (existing) {
      res.status(200).json(existing); // déjà réservée : même réponse, aucune nouvelle écriture ni conversion
      return;
    }
  }

  // Connecté : la réservation est rattachée au compte et apparaît dans « Mes séances ».
  const userId = (await currentUser(req))?._id;

  // Span métier : deux identifiants techniques, jamais le nom, l'e-mail ni le téléphone (données personnelles).
  await tracer.startActiveSpan("movies.reservation", { attributes: { "movies.screening.id": screening.id } }, async (span) => {
    try {
      // Tous les sièges d'une réservation ou aucun : en cas de conflit, on supprime ceux déjà insérés.
      const bookingId = new ObjectId();
      const createdAt = new Date();
      try {
        await reservations().insertMany(
          seats.map((seat) => ({ screeningId: screening.id, seat, name, email, phone, bookingId, createdAt, ...(requestId && { requestId }), ...(userId && { userId }) })),
          { ordered: false },
        );
      } catch (e) {
        if (!(e instanceof MongoBulkWriteError) || e.code !== 11000) throw e;
        await reservations().deleteMany({ screeningId: screening.id, bookingId });
        // Deux envois simultanés de la même demande : le second tombe sur les sièges du premier, ce n'est pas un conflit.
        const existing = requestId ? await findByRequest(screening.id, requestId) : null;
        if (existing) {
          res.status(200).json(existing);
          return;
        }
        const conflicts = (
          await reservations()
            .find({ screeningId: screening.id, seat: { $in: seats } }, { projection: { seat: 1 } })
            .toArray()
        ).map((r) => r.seat);
        res.status(409).json({ error: `Sièges déjà réservés : ${conflicts.join(", ")}`, seats: conflicts });
        return;
      }
      span.setAttribute("movies.booking.id", bookingId.toHexString());

      // Enregistrer, puis notifier : l'événement ne part qu'après l'écriture réussie.
      publish(screening.id, { type: "seat-updated", screeningId: screening.id, seats, status: "BOOKED" });

      // SMS de confirmation : le statut est gardé pour l'historique. Le prestataire est lent (≈ 1 s).
      const sms = confirmBySms(screening, bookingId, seats, phone);
      if (TP_TICKETS) await sms; // TP OpenTelemetry, ticket T1 : la réponse attend le prestataire SMS.
      else sms.catch((e) => console.error("SMS de confirmation impossible :", e));

      // Conversion A/B : après l'écriture réussie, jamais au clic. Une panne de la mesure ne fait pas échouer la réservation.
      await recordConversion(req).catch((e) => console.error("Attribution A/B impossible :", e));
      res.status(201).json({ bookingId, screeningId: screening.id, seats, name });
    } catch (e) {
      span.recordException(e as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw e;
    } finally {
      span.end();
    }
  });
});

async function confirmBySms(screening: Awaited<ReturnType<typeof findScreening>>, bookingId: ObjectId, seats: string[], phone: string) {
  const status = await sendSms(phone, `Movies : ${seats.join(", ")} le ${screening.date} à ${screening.time} (${String(screening.movie.title)}).`);
  if (status) await reservations().updateMany({ screeningId: screening.id, bookingId }, { $set: { smsStatus: status, smsAt: new Date() } });
}

// DELETE /screenings/:id/reservations/:bookingId : annule une réservation (libère tous ses sièges).
router.delete("/:id/reservations/:bookingId", async (req, res) => {
  const screening = await findScreening(req.params.id);
  if (!/^[0-9a-f]{24}$/i.test(req.params.bookingId)) throw new HttpError(400, "Identifiant de réservation invalide");
  const bookingId = new ObjectId(req.params.bookingId);
  const seats = (await reservations().find({ screeningId: screening.id, bookingId }).toArray()).map((r) => r.seat);
  if (!seats.length) throw new HttpError(404, "Réservation introuvable");
  await reservations().deleteMany({ screeningId: screening.id, bookingId });
  publish(screening.id, { type: "seat-updated", screeningId: screening.id, seats, status: "AVAILABLE" });
  res.status(204).end();
});

export default router;
