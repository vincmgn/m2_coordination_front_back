import { Router } from "express";
import { ObjectId, type Filter } from "mongodb";
import { getDB } from "../db.js";
import { HttpError } from "../http-error.js";
import { cleanText } from "../security.js";
import { requireAdmin } from "./auth.js";
import { searchMovies } from "./search.js";

interface Movie {
  title: string;
  year?: number;
  genres?: string[];
  poster?: string;
  imdb?: { rating?: number; votes?: number; id?: number };
  [field: string]: unknown;
}

type MovieSummary = Pick<Movie, "title" | "year" | "genres" | "poster"> & {
  _id: ObjectId;
  imdb?: { rating?: number };
};

const router = Router();

const LIST_PROJECTION = { title: 1, year: 1, genres: 1, "imdb.rating": 1, poster: 1 };
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const movies = () => getDB().collection<Movie>("movies");

const notFound = () => new HttpError(404, "Film introuvable");

function parseId(id: string): ObjectId {
  if (!/^[0-9a-f]{24}$/i.test(id)) {
    throw new HttpError(400, "Identifiant invalide (24 caractères hexadécimaux attendus)");
  }
  return new ObjectId(id);
}

function parsePositiveInt(value: unknown, name: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 1_000_000) {
    throw new HttpError(400, `Le paramètre "${name}" doit être un entier positif`);
  }
  return n;
}

function parseStringParam(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new HttpError(400, `Le paramètre "${name}" ne doit être fourni qu'une seule fois`);
  }
  if (value.length > 100) throw new HttpError(400, `Le paramètre "${name}" est trop long (100 caractères au plus)`);
  return value.trim() || undefined;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const FIELDS = ["title", "year", "genres", "plot", "poster"] as const;
const MAX = { title: 200, plot: 2000, poster: 500, genre: 40, genres: 10 };

function isHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validateMovie(body: unknown, options: { partial: false }): Movie;
function validateMovie(body: unknown, options: { partial: true }): Partial<Movie>;
function validateMovie(body: unknown, { partial }: { partial: boolean }): Partial<Movie> {
  if (!isPlainObject(body)) {
    throw new HttpError(400, "Le corps doit être un objet JSON (header Content-Type: application/json)");
  }
  const unknown = Object.keys(body).filter((k) => !(FIELDS as readonly string[]).includes(k));
  if (unknown.length) throw new HttpError(400, `Champs non autorisés : ${unknown.slice(0, 5).map((k) => k.slice(0, 30)).join(", ")}`);
  if (partial && Object.keys(body).length === 0) throw new HttpError(400, "Aucun champ à modifier");

  const out: Partial<Movie> = {};
  if (!partial || "title" in body) {
    if (typeof body.title !== "string" || !cleanText(body.title) || body.title.length > MAX.title) {
      throw new HttpError(400, `Le champ "title" est requis (1 à ${MAX.title} caractères)`);
    }
    out.title = cleanText(body.title);
  }
  if ("year" in body) {
    if (!Number.isInteger(body.year) || (body.year as number) < 1870 || (body.year as number) > 2100) {
      throw new HttpError(400, 'Le champ "year" doit être une année entre 1870 et 2100');
    }
    out.year = body.year as number;
  }
  if ("genres" in body) {
    const g = body.genres;
    if (!Array.isArray(g) || g.length > MAX.genres || !g.every((x) => typeof x === "string" && cleanText(x) && x.length <= MAX.genre)) {
      throw new HttpError(400, `Le champ "genres" doit être un tableau de ${MAX.genres} chaînes au plus (${MAX.genre} caractères chacune)`);
    }
    out.genres = [...new Set(g.map((x: string) => cleanText(x)))];
  }
  if ("plot" in body) {
    if (typeof body.plot !== "string" || body.plot.length > MAX.plot) throw new HttpError(400, `Le champ "plot" doit faire ${MAX.plot} caractères au plus`);
    out.plot = body.plot.replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === "\n" ? c : "")).trim();
  }
  if ("poster" in body) {
    if (typeof body.poster !== "string" || body.poster.length > MAX.poster || !isHttpsUrl(body.poster)) {
      throw new HttpError(400, 'Le champ "poster" doit être une adresse https://');
    }
    out.poster = body.poster;
  }
  return out;
}

router.get("/", async (req, res) => {
  const page = parsePositiveInt(req.query.page, "page") ?? 1;
  if (page > 1000) throw new HttpError(400, 'Le paramètre "page" doit être au plus 1000');
  const limit = Math.min(parsePositiveInt(req.query.limit, "limit") ?? DEFAULT_LIMIT, MAX_LIMIT);
  const year = parsePositiveInt(req.query.year, "year");
  const title = parseStringParam(req.query.title, "title");
  const genre = parseStringParam(req.query.genre, "genre");

  const filter: Filter<Movie> = {};
  if (title) filter.title = new RegExp(escapeRegex(title), "i");
  if (year !== undefined) filter.year = year;
  if (genre) filter.genres = new RegExp(`^${escapeRegex(genre)}$`, "i");

  const [total, data] = await Promise.all([
    movies().countDocuments(filter),
    movies()
      .find(filter)
      .project<MovieSummary>(LIST_PROJECTION)
      .sort({ _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
  ]);

  res.json({ page, limit, total, totalPages: Math.ceil(total / limit), data });
});

router.get("/search", searchMovies);

router.get("/genres", async (_req, res) => {
  const genres = await movies().distinct("genres");
  res.json(genres.filter((g): g is string => typeof g === "string").sort());
});

router.get("/:id", async (req, res) => {
  const movie = await movies().findOne({ _id: parseId(req.params.id) });
  if (!movie) throw notFound();
  res.json(movie);
});

router.post("/", async (req, res) => {
  await requireAdmin(req);
  const movie = validateMovie(req.body, { partial: false });
  const { insertedId } = await movies().insertOne(movie);
  res
    .status(201)
    .location(`${req.baseUrl}/${insertedId}`)
    .json({ ...movie, _id: insertedId });
});

router.put("/:id", async (req, res) => {
  await requireAdmin(req);
  const _id = parseId(req.params.id);
  const changes = validateMovie(req.body, { partial: true });
  const updated = await movies().findOneAndUpdate({ _id }, { $set: changes }, { returnDocument: "after" });
  if (!updated) throw notFound();
  res.json(updated);
});

router.delete("/:id", async (req, res) => {
  await requireAdmin(req);
  const { deletedCount } = await movies().deleteOne({ _id: parseId(req.params.id) });
  if (deletedCount === 0) throw notFound();
  res.status(204).end();
});

export default router;
