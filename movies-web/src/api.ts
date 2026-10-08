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
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (res.status === 204) return undefined as T

  const body = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `Erreur HTTP ${res.status}`)
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
