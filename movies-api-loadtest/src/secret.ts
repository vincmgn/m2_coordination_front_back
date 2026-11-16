import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Secret serveur pour signer les jetons d'annulation des réservations faites sans compte.
// APP_SECRET (32 caractères au moins) doit être fourni en production, hors du dépôt (.env, secret Docker).
// Sans lui, un secret aléatoire est tiré au démarrage : les jetons déjà donnés ne valent plus après un redémarrage.
const fromEnv = process.env.APP_SECRET ?? "";
if (fromEnv && fromEnv.length < 32) throw new Error("APP_SECRET doit faire au moins 32 caractères");
if (!fromEnv) console.warn("APP_SECRET absent : secret aléatoire pour cette exécution (jetons d'annulation perdus au redémarrage)");
const SECRET = fromEnv || randomBytes(32).toString("hex");

// Jeton d'annulation d'une réservation : HMAC-SHA256(secret, bookingId), 128 bits en hexadécimal.
// Imprévisible même si le bookingId l'est (un ObjectId contient l'heure et un compteur).
export const cancelToken = (bookingId: string) => createHmac("sha256", SECRET).update(`cancel:${bookingId}`).digest("hex").slice(0, 32);

export function checkCancelToken(bookingId: string, token: unknown) {
  if (typeof token !== "string" || !/^[0-9a-f]{32}$/.test(token)) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(cancelToken(bookingId)));
}
