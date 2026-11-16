import type { Request, Response } from "express";
import { getDB } from "../db.js";
import { HttpError } from "../http-error.js";

const MIN_LENGTH = 2;
const MAX_LENGTH = 60;
const LIMIT = 20;
const LAB = process.env.SEARCH_LAB === "1";

export const normalize = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const VARIANTS: Record<string, string> = {
  a: "aàáâãäåāăą",
  c: "cçćĉċč",
  e: "eèéêëēĕėęě",
  i: "iìíîïĩīĭįı",
  n: "nñńņňŉ",
  o: "oòóôõöøōŏő",
  u: "uùúûüũūŭůűų",
  y: "yýÿŷ",
};
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const accentInsensitive = (normalized: string) =>
  [...normalized].map((ch) => (VARIANTS[ch] ? `[${VARIANTS[ch]}]` : escapeRegex(ch))).join("");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function labBehaviour(normalized: string) {
  if (!LAB) return;
  if (normalized === "erreur") throw new HttpError(503, "Service de recherche indisponible (erreur simulée, profil lab)");
  await sleep(normalized === "ma" ? 1200 : normalized === "mar" ? 100 : 180);
}

export async function searchMovies(req: Request, res: Response) {
  if (typeof req.query.q !== "string") throw new HttpError(400, 'Le paramètre "q" est requis');
  const query = req.query.q.trim();
  if (query.length < MIN_LENGTH || query.length > MAX_LENGTH) {
    throw new HttpError(400, `Le paramètre "q" doit contenir de ${MIN_LENGTH} à ${MAX_LENGTH} caractères`);
  }

  const normalized = normalize(query);
  await labBehaviour(normalized);

  const words = normalized.split(/[\s,;]+/).filter(Boolean);
  if (!words.length) {
    res.json({ query, items: [] });
    return;
  }
  const filter = {
    $and: words.map((word) => {
      const pattern = new RegExp(accentInsensitive(word), "i");
      const criteria: Record<string, unknown>[] = [{ title: pattern }, { genres: pattern }];
      if (/^\d{4}$/.test(word)) criteria.push({ year: Number(word) });
      return { $or: criteria };
    }),
  };

  const docs = await getDB()
    .collection("movies")
    .find(filter, { projection: { title: 1, year: 1, genres: 1, poster: 1, "imdb.rating": 1 } })
    .sort({ title: 1, _id: 1 })
    .limit(LIMIT)
    .toArray();

  res.json({
    query,
    items: docs.map((d) => ({ id: d._id, title: d.title, year: d.year, genres: d.genres ?? [], poster: d.poster, imdb: d.imdb })),
  });
}
