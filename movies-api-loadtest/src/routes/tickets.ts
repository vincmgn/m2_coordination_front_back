import { Router, type Request } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../db.js";
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
//   500  le rendu a échoué                     { error: "Erreur interne du serveur" }
// Un GET qui ne modifie rien : le cookie de session (SameSite=Lax) suffit, pas de jeton CSRF.
// Le routeur ne fabrique rien : le service vérifie les droits, puis fabrique.

export interface TicketDeps {
  store: TicketStore;
  userId(req: Request): Promise<string>; // lève 401 sans session
}

export function ticketsRouter(deps: TicketDeps) {
  const router = Router();
  router.get("/mine/:bookingId/ticket.pdf", async (req, res) => {
    res.set("Cache-Control", "no-store"); // erreurs comprises
    const ticket = await buildTicket(await deps.userId(req), req.params.bookingId, deps.store);
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
