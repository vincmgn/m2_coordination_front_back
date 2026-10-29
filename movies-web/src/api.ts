// Client de l'API movies-api-loadtest. En dev, /api est relayé par Vite vers http://localhost:3000.
const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

export interface MovieSummary {
  _id: string
  title: string
  year?: number
  genres?: string[]
  poster?: string
  imdb?: { rating?: number }
}

export interface Movie extends MovieSummary {
  plot?: string
  fullplot?: string
  runtime?: number
  cast?: string[]
  directors?: string[]
  countries?: string[]
  released?: string
  rated?: string
  awards?: { text?: string }
  imdb?: { rating?: number; votes?: number }
}

export interface Paginated<T> {
  page: number
  limit: number
  total: number
  totalPages: number
  data: T[]
}

export interface MovieFilters {
  page?: number
  limit?: number
  title?: string
  year?: number
  genre?: string
}

export type MovieInput = Pick<Movie, 'title' | 'year' | 'genres' | 'plot' | 'poster'>

// Erreur renvoyée par l'API ({ error: "..." }) avec son code HTTP.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> | null = null,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers as Record<string, string>) },
  })
  if (res.status === 204) return undefined as T

  const body = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `Erreur HTTP ${res.status}`, body)
  return body as T
}

export function listMovies(filters: MovieFilters): Promise<Paginated<MovieSummary>> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  return request(`/movies?${params}`)
}

export const listGenres = () => request<string[]>('/movies/genres')

export const getMovie = (id: string) => request<Movie>(`/movies/${id}`)

export const createMovie = (movie: MovieInput) =>
  request<Movie>('/movies', { method: 'POST', body: JSON.stringify(movie) })

export const updateMovie = (id: string, changes: Partial<MovieInput>) =>
  request<Movie>(`/movies/${id}`, { method: 'PUT', body: JSON.stringify(changes) })

export const deleteMovie = (id: string) => request<void>(`/movies/${id}`, { method: 'DELETE' })

// --- Séances et réservation de places ---------------------------------------------------------

export interface Screening {
  id: string
  date: string // AAAA-MM-JJ (heure de Paris)
  time: string // HH:MM
  capacity: number
  available: number
}

export interface ScreeningDetail {
  id: string
  date: string
  time: string
  movie: Pick<Movie, '_id' | 'title' | 'year' | 'poster' | 'runtime'>
  room: { rows: string[]; seatsPerRow: number; capacity: number }
  taken: string[]
}

export interface Booking {
  bookingId: string
  screeningId: string
  seats: string[]
  name: string
}

export const listScreenings = (movieId: string) => request<Screening[]>(`/screenings?movieId=${movieId}`)

export const getScreening = (id: string) => request<ScreeningDetail>(`/screenings/${id}`)

// measure : le navigateur participe au test A/B ; sans lui (mode de secours), le back n'attribue pas la réservation.
export interface Contact {
  name: string
  email: string
  phone: string
}

// requestId : identifiant de la demande ; la renvoyer (après une panne) ne réserve jamais deux fois.
export const reserveSeats = (id: string, seats: string[], contact: Contact, requestId: string, measure = false) =>
  request<Booking>(`/screenings/${id}/reservations`, {
    method: 'POST',
    body: JSON.stringify({ seats, ...contact, requestId }),
    headers: measure ? { 'X-AB-Measure': '1' } : {},
  })

export const cancelBooking = (id: string, bookingId: string) =>
  request<void>(`/screenings/${id}/reservations/${bookingId}`, { method: 'DELETE' })

// Flux SSE de la séance : URL à passer à EventSource (même préfixe /api que les autres appels).
export const screeningEventsUrl = (id: string) => `${BASE_URL}/screenings/${id}/events`

// --- Test A/B ----------------------------------------------------------------------------------
// Le back affecte la variante (cookie ab_visitor) et enregistre la conversion ; le front ne fait qu'afficher
// la variante reçue et signaler l'exposition.

export type Variant = 'A' | 'B'

export interface AbAssignment {
  experiment: string
  enabled: boolean
  variant: Variant
  bucket?: number
}

export const getAssignment = (signal: AbortSignal) => request<AbAssignment>('/ab/assignment', { signal })

// keepalive : la déclaration part même si la page se ferme juste après. Erreur ignorée : la mesure ne gêne jamais le visiteur.
export const declareExposure = () =>
  request<void>('/ab/exposure', { method: 'POST', keepalive: true }).catch(() => {})

// --- Recherche réactive ------------------------------------------------------------------------

// Mêmes champs que MovieSummary, avec id au lieu de _id (contrat de la recherche).
export type SearchItem = Omit<MovieSummary, '_id'> & { id: string }

export interface SearchResponse {
  query: string
  items: SearchItem[]
}

// signal : permet d'annuler l'appel (AbortController) quand la saisie change.
export const searchMovies = (q: string, signal: AbortSignal) =>
  request<SearchResponse>(`/movies/search?${new URLSearchParams({ q })}`, { signal })

// --- Authentification et « Mes séances » -------------------------------------------------------
// Session dans un cookie httpOnly posé par l'API : le front n'y touche jamais, il est envoyé avec chaque appel.

export interface User {
  id: string
  email: string
  name: string
}

export const getMe = () => request<User>('/auth/me')

export const login = (email: string, password: string) =>
  request<User>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })

export const register = (email: string, password: string, name: string) =>
  request<User>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name }) })

export const logout = () => request<void>('/auth/logout', { method: 'POST' })

export interface MyBooking {
  bookingId: string
  screeningId: string
  date: string
  time: string
  upcoming: boolean
  movie: { _id: string; title: string; poster?: string }
  seats: string[]
  name: string
}

export const listMyBookings = () => request<MyBooking[]>('/screenings/mine')
