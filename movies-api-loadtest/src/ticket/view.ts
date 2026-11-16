import { formatDay, formatInstant, formatTime } from "./formats.js";

// Cinéma fictif : toutes les séances ont lieu dans la même salle (cf. routes/screenings.ts).
export const CINEMA = { name: "Cinéma Movies", room: "Salle 1", address: "1 place des Lumières, 69008 Lyon" };

// Tout ce que le billet imprime, déjà mis en forme : le rendu ne fait qu'afficher, aucun calcul.
export interface TicketView {
  reference: string; // numéro de réservation
  spectatorName: string;
  movieTitle: string;
  movieYear: string; // « 1999 », ou vide
  day: string; // « mardi 24 novembre 2026 »
  time: string; // « 21 h 00 », heure de Paris
  seats: string; // « E5, E6 »
  placeCount: string; // « 2 »
  placeLabel: string; // « places » ou « place »
  posterColor: string; // même couleur que l'affiche de remplacement du front (MoviePoster.vue)
  cinema: string;
  room: string;
  address: string;
  bookedOn: string; // « 21 novembre 2026 à 9 h 30 », heure de Paris
  issuedOn: string;
}

export interface TicketBooking {
  bookingId: string;
  screeningId: string; // <id du film>-<AAAAMMJJ>-<HHMM>, heure de Paris
  seats: string[];
  name: string;
  createdAt: Date;
}

// Couleur stable par titre, même calcul que movies-web/src/components/MoviePoster.vue.
const POSTER_COLORS = ["#ffb547", "#7ce0c3", "#ff7a9a", "#b7a6ff", "#f3f1ec", "#8fc9ff"];
const posterColor = (title: string) => POSTER_COLORS[[...title].reduce((sum, c) => sum + c.charCodeAt(0), 0) % POSTER_COLORS.length]!;

const bySeat = (a: string, z: string) => a[0]!.localeCompare(z[0]!) || Number(a.slice(1)) - Number(z.slice(1));

export function toTicketView(booking: TicketBooking, movie: { title?: string; year?: unknown } | null, now: Date): TicketView {
  const [, y, m, d, hh, mm] = booking.screeningId.match(/^[0-9a-f]{24}-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/i)!;
  const seats = [...booking.seats].sort(bySeat);
  const movieTitle = movie?.title ?? "Film supprimé";
  return {
    reference: booking.bookingId,
    spectatorName: booking.name,
    movieTitle,
    movieYear: typeof movie?.year === "number" ? String(movie.year) : "",
    day: formatDay(`${y}-${m}-${d}`),
    time: formatTime(`${hh}:${mm}`),
    seats: seats.join(", "),
    placeCount: String(seats.length),
    placeLabel: seats.length > 1 ? "places" : "place",
    posterColor: posterColor(movieTitle),
    cinema: CINEMA.name,
    room: CINEMA.room,
    address: CINEMA.address,
    bookedOn: formatInstant(booking.createdAt),
    issuedOn: formatInstant(now),
  };
}
