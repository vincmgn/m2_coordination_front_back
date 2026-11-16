import { HttpError } from "../http-error.js";
import { renderTicket } from "./renderer.js";
import { toTicketView, type TicketBooking } from "./view.js";

// Billet PDF d'une réservation : les droits d'abord, la fabrication ensuite.
// Aucun PDF n'est fabriqué pour une réservation qui n'appartient pas au compte connecté.

export const NOT_FOUND = "Réservation introuvable";
export const CANCELLED = "Cette réservation a été annulée : elle n'a plus de billet.";

// Accès aux données, remplaçable par un faux dans les tests (pas de base nécessaire).
export interface TicketStore {
  // Réservation du compte userId, ou null (inexistante, annulée ou d'un autre compte).
  findBooking(userId: string, bookingId: string): Promise<TicketBooking | null>;
  // La réservation a-t-elle été annulée par ce compte ?
  isCancelled(userId: string, bookingId: string): Promise<boolean>;
  findMovie(movieId: string): Promise<{ title?: string; year?: unknown } | null>;
}

export interface Ticket {
  filename: string;
  pdf: Buffer;
}

// Nom du fichier : uniquement le numéro de réservation. Ni nom, ni titre du film, ni date.
export const ticketFilename = (bookingId: string) => `billet-${bookingId}.pdf`;

export async function buildTicket(userId: string, bookingId: string, store: TicketStore, render = renderTicket, now = new Date()): Promise<Ticket> {
  // Identifiant mal formé : même réponse qu'une réservation inconnue (le contrat ne connaît que 401, 404, 409, 500).
  if (!/^[0-9a-f]{24}$/i.test(bookingId)) throw new HttpError(404, NOT_FOUND);
  const id = bookingId.toLowerCase();

  const booking = await store.findBooking(userId, id);
  if (!booking) {
    // 404 et non 403 pour la réservation d'un autre : un 403 avouerait qu'elle existe.
    if (await store.isCancelled(userId, id)) throw new HttpError(409, CANCELLED);
    throw new HttpError(404, NOT_FOUND);
  }

  const movie = await store.findMovie(booking.screeningId.slice(0, 24));
  const pdf = await render(toTicketView(booking, movie, now));
  return { filename: ticketFilename(id), pdf };
}
