import { Router } from "express";
import { ObjectId, type Filter } from "mongodb";
import { getDB } from "../db.js";

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

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const notFound = () => new HttpError(404, "Film introuvable");

function parseId(id: string): ObjectId {
  if (!/^[0-9a-f]{24}$/i.test(id)) {
    throw new HttpError(400, `Identifiant invalide : "${id}" (24 caractères hexadécimaux attendus)`);
  }
  return new ObjectId(id);
}

function parsePositiveInt(value: unknown, name: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new HttpError(400, `Le paramètre "${name}" doit être un entier positif`);
  }
  return n;
}

function parseStringParam(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new HttpError(400, `Le paramètre "${name}" ne doit être fourni qu'une seule fois`);
  }
  return value.trim() || undefined;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function validateMovie(body: unknown, options: { partial: false }): Movie;
function validateMovie(body: unknown, options: { partial: true }): Partial<Movie>;
function validateMovie(body: unknown, { partial }: { partial: boolean }): Partial<Movie> {
  if (!isPlainObject(body)) {
    throw new HttpError(400, "Le corps doit être un objet JSON (header Content-Type: application/json)");
  }

  const keys = Object.keys(body);
  if (keys.includes("_id")) {
    throw new HttpError(400, 'Le champ "_id" est géré par la base et ne peut pas être fourni');
  }
  if (keys.some((k) => k.startsWith("$"))) {
    throw new HttpError(400, 'Les noms de champs ne peuvent pas commencer par "$"');
  }
  if (partial && keys.length === 0) {
    throw new HttpError(400, "Aucun champ à modifier");
  }

  if (!partial || "title" in body) {
    if (typeof body.title !== "string" || !body.title.trim()) {
      throw new HttpError(400, 'Le champ "title" est requis et doit être une chaîne non vide');
    }
  }
  if ("year" in body && !Number.isInteger(body.year)) {
    throw new HttpError(400, 'Le champ "year" doit être un entier');
  }
  if ("genres" in body && !(Array.isArray(body.genres) && body.genres.every((g) => typeof g === "string"))) {
    throw new HttpError(400, 'Le champ "genres" doit être un tableau de chaînes');
  }

  return body as Partial<Movie>;
}

router.get("/", async (req, res) => {
  const page = parsePositiveInt(req.query.page, "page") ?? 1;
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

router.get("/:id", async (req, res) => {
  const movie = await movies().findOne({ _id: parseId(req.params.id) });
  if (!movie) throw notFound();
  res.json(movie);
});

router.post("/", async (req, res) => {
  const movie = validateMovie(req.body, { partial: false });
  const { insertedId } = await movies().insertOne(movie);
  res
    .status(201)
    .location(`${req.baseUrl}/${insertedId}`)
    .json({ ...movie, _id: insertedId });
});

// Mise à jour partielle : seuls les champs envoyés sont modifiés ($set), les autres sont conservés.
router.put("/:id", async (req, res) => {
  const _id = parseId(req.params.id);
  const changes = validateMovie(req.body, { partial: true });
  const updated = await movies().findOneAndUpdate({ _id }, { $set: changes }, { returnDocument: "after" });
  if (!updated) throw notFound();
  res.json(updated);
});

router.delete("/:id", async (req, res) => {
  const { deletedCount } = await movies().deleteOne({ _id: parseId(req.params.id) });
  if (deletedCount === 0) throw notFound();
  res.status(204).end();
});

export default router;
