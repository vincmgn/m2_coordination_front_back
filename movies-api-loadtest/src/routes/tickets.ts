import { Router, type Request } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../db.js";
import { HttpError } from "../http-error.js";
import { buildTicket, type TicketStore } from "../ticket/service.js";
import { requireUser } from "./auth.js";

// GET /screenings/mine/:bookingId/ticket.pdf[?download=true] : billet PDF d'une réservation du compte connecté.
//
// Contrat :
//   200  application/pdf ; Content-Disposition inline (affichage) ou attachment (download=true),
//        filename="billet-<bookingId>.pdf" ; Cache-Control: no-store ; X-Content-Type-Options: nosniff
//   401  pas de session                       { error: "Connexion requise" }
//   404  réservation inconnue ou d'un autre    { error: "Réservation introuvable" }
//   409  réservation annulée                   { error: "Cette réservation a été annulée : …" }
//   429  plus de 30 billets en 1 min par compte { error: "Trop de billets demandés…" } + Retry-After
//   500  le rendu a échoué                     { error: "Erreur interne du serveur" }
// Un GET qui ne modifie rien : le cookie de session (SameSite=Lax) suffit, pas de jeton CSRF.
// Le routeur ne fabrique rien : le service vérifie les droits, puis fabrique.

export interface TicketDeps {
  store: TicketStore;
  userId(req: Request): Promise<string>; // lève 401 sans session
  limit?: { max: number; windowMs: number };
}

export const TOO_MANY = "Trop de billets demandés en peu de temps. Réessayez dans une minute.";

// Limite par compte : chaque billet est fabriqué à la demande (CPU), un compte ne doit pas pouvoir en demander en boucle.
// 30 par minute laisse large : un affichage coûte 2 requêtes (vérification, puis l'onglet), un enregistrement 1.
// En mémoire : suffisant avec une seule instance de l'API (avec plusieurs, il faudrait un compteur partagé).
function rateLimiter({ max, windowMs }: { max: number; windowMs: number }) {
  const hits = new Map<string, number[]>();
  return (key: string, now = Date.now()) => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return Math.ceil((recent[0]! + windowMs - now) / 1000); // secondes avant la prochaine place libre
    }
    recent.push(now);
    hits.set(key, recent);
    // Ménage : les comptes inactifs ne restent pas en mémoire.
    if (hits.size > 10_000) for (const [k, list] of hits) if (now - list[list.length - 1]! >= windowMs) hits.delete(k);
    return 0;
  };
}

export function ticketsRouter(deps: TicketDeps) {
  const router = Router();
  const tooSoon = rateLimiter(deps.limit ?? { max: 30, windowMs: 60_000 });
  router.get("/mine/:bookingId/ticket.pdf", async (req, res) => {
    res.set("Cache-Control", "no-store"); // erreurs comprises
    const userId = await deps.userId(req);
    const wait = tooSoon(userId);
    if (wait) {
      res.set("Retry-After", String(wait));
      throw new HttpError(429, TOO_MANY);
    }
    const ticket = await buildTicket(userId, req.params.bookingId, deps.store);
    const disposition = req.query.download === "true" ? "attachment" : "inline";
    res.status(200).set({
      "Content-Type": "application/pdf",
      "Content-Length": String(ticket.pdf.length),
      "Content-Disposition": `${disposition}; filename="${ticket.filename}"`,
      "X-Content-Type-Options": "nosniff",
    });
    res.end(ticket.pdf);
  });
  return router;
}

// --- Implémentation MongoDB ----------------------------------------------------------------------

interface ReservationRow {
  screeningId: string;
  seat: string;
  name: string;
  bookingId: ObjectId;
  userId?: ObjectId;
  createdAt: Date;
}

export const mongoTicketStore: TicketStore = {
  async findBooking(userId, bookingId) {
    const rows = await getDB()
      .collection<ReservationRow>("reservations")
      .find({ userId: new ObjectId(userId), bookingId: new ObjectId(bookingId) })
      .toArray();
    if (!rows.length) return null;
    const first = rows[0]!;
    return { bookingId, screeningId: first.screeningId, seats: rows.map((r) => r.seat), name: first.name, createdAt: first.createdAt };
  },
  async isCancelled(userId, bookingId) {
    return !!(await getDB()
      .collection("cancellations")
      .countDocuments({ userId: new ObjectId(userId), bookingId: new ObjectId(bookingId) }, { limit: 1 }));
  },
  async findMovie(movieId) {
    return getDB()
      .collection("movies")
      .findOne<{ title?: string; year?: unknown }>({ _id: new ObjectId(movieId) }, { projection: { title: 1, year: 1 } });
  },
};

export default ticketsRouter({
  store: mongoTicketStore,
  userId: async (req) => String((await requireUser(req))._id),
});
