import { formatDay, formatInstant, formatTime } from "./formats.js";

export const CINEMA = { name: "Cinéma Movies", room: "Salle 1", address: "1 place des Lumières, 69008 Lyon" };

export interface TicketView {
  reference: string;
  spectatorName: string;
  movieTitle: string;
  movieYear: string;
  day: string;
  time: string;
  seats: string;
  placeCount: string;
  placeLabel: string;
  posterColor: string;
  cinema: string;
  room: string;
  address: string;
  bookedOn: string;
  issuedOn: string;
}

export interface TicketBooking {
  bookingId: string;
  screeningId: string;
  seats: string[];
  name: string;
  createdAt: Date;
}

const POSTER_COLORS = ["#ffb547", "#7ce0c3", "#ff7a9a", "#b7a6ff", "#f3f1ec", "#8fc9ff"];
export const posterColor = (title: string) => POSTER_COLORS[[...title].reduce((sum, c) => sum + c.charCodeAt(0), 0) % POSTER_COLORS.length]!;

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
