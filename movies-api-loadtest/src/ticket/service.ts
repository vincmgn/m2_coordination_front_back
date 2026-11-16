import { HttpError } from "../http-error.js";
import { renderTicket } from "./renderer.js";
import { toTicketView, type TicketBooking } from "./view.js";

export const NOT_FOUND = "Réservation introuvable";
export const CANCELLED = "Cette réservation a été annulée : elle n'a plus de billet.";

export interface TicketStore {
  findBooking(userId: string, bookingId: string): Promise<TicketBooking | null>;
  isCancelled(userId: string, bookingId: string): Promise<boolean>;
  findMovie(movieId: string): Promise<{ title?: string; year?: unknown } | null>;
}

export interface Ticket {
  filename: string;
  pdf: Buffer;
}

export const ticketFilename = (bookingId: string) => `billet-${bookingId}.pdf`;

export async function buildTicket(userId: string, bookingId: string, store: TicketStore, render = renderTicket, now = new Date()): Promise<Ticket> {
  if (!/^[0-9a-f]{24}$/i.test(bookingId)) throw new HttpError(404, NOT_FOUND);
  const id = bookingId.toLowerCase();

  const booking = await store.findBooking(userId, id);
  if (!booking) {
    if (await store.isCancelled(userId, id)) throw new HttpError(409, CANCELLED);
    throw new HttpError(404, NOT_FOUND);
  }

  const movie = await store.findMovie(booking.screeningId.slice(0, 24));
  const pdf = await render(toTicketView(booking, movie, now));
  return { filename: ticketFilename(id), pdf };
}
