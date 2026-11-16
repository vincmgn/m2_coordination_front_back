import { Router, type Request } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../db.js";
import { rateLimiter } from "../rate-limit.js";
import { buildTicket, type TicketStore } from "../ticket/service.js";
import { requireUser } from "./auth.js";

export interface TicketDeps {
  store: TicketStore;
  userId(req: Request): Promise<string>;
  limit?: { max: number; windowMs: number };
}

export const TOO_MANY = "Trop de billets demandés en peu de temps. Réessayez dans une minute.";

export function ticketsRouter(deps: TicketDeps) {
  const router = Router();
  const limiter = rateLimiter(deps.limit ?? { max: 30, windowMs: 60_000 });
  router.get("/mine/:bookingId/ticket.pdf", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const userId = await deps.userId(req);
    limiter.check(userId, res, TOO_MANY);
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
