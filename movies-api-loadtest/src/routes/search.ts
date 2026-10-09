import type { Request, Response } from "express";
import { getDB } from "../db.js";
import { HttpError } from "../http-error.js";

// Recherche réactive (contrat du cours « recherche réactive », adapté aux films) :
//   GET /movies/search?q=…   q nettoyé aux extrémités, 2 à 60 caractères, sinon 400
//   critères                 chaque mot doit correspondre au titre OU au genre (sous-chaîne) OU à l'année
//                            (si le mot est une année) : « matrix 1999 », « drama, 1999 », « star wars 1977 »
//                            ; les mots sont séparés par des espaces, virgules ou points-virgules
//   casse et accents         ignorés (« AMÉLIE » = « amelie »)
//   caractères spéciaux      littéraux : « .* » cherche un point suivi d'une étoile
//   réponse                  { query, items: [{ id, title, year, genres, poster, imdb }] }, triée par titre, 20 max
// Profil lab (SEARCH_LAB=1, jamais en production) : « ma » répond en 1 200 ms, « mar » en 100 ms, un autre
// texte en 180 ms, « erreur » renvoie 503. Sert à provoquer des réponses qui reviennent dans le désordre.

const MIN_LENGTH = 2;
const MAX_LENGTH = 60;
const LIMIT = 20;
const LAB = process.env.SEARCH_LAB === "1";

// Même transformation pour la saisie et pour les données : décomposition Unicode, retrait des accents, minuscules.
export const normalize = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

// Les titres stockés gardent leurs accents : chaque lettre de la saisie normalisée devient une classe
// qui accepte ses variantes accentuées (ex. « e » → [eèéêëēĕėęě]). Le reste est échappé, donc littéral.
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

  // Chaque mot doit correspondre à au moins un critère (ET entre les mots, OU entre les critères) :
  // titre OU genre (sous-chaîne, accents ignorés) OU année exacte si le mot est une année.
  // Mots séparés par des espaces, virgules ou points-virgules : « matrix, 1999 » = « matrix 1999 ».
  const words = normalized.split(/[\s,;]+/).filter(Boolean);
  if (!words.length) {
    res.json({ query, items: [] }); // ex. « ,, » : aucun mot à chercher
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

  // Champs publics uniquement (équivalent du DTO du cours).
  res.json({
    query,
    items: docs.map((d) => ({ id: d._id, title: d.title, year: d.year, genres: d.genres ?? [], poster: d.poster, imdb: d.imdb })),
  });
}
