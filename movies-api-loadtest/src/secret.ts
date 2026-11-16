import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const fromEnv = process.env.APP_SECRET ?? "";
if (fromEnv && fromEnv.length < 32) throw new Error("APP_SECRET doit faire au moins 32 caractères");
if (!fromEnv) console.warn("APP_SECRET absent : secret aléatoire pour cette exécution (jetons d'annulation perdus au redémarrage)");
const SECRET = fromEnv || randomBytes(32).toString("hex");

export const cancelToken = (bookingId: string) => createHmac("sha256", SECRET).update(`cancel:${bookingId}`).digest("hex").slice(0, 32);

export function checkCancelToken(bookingId: string, token: unknown) {
  if (typeof token !== "string" || !/^[0-9a-f]{32}$/.test(token)) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(cancelToken(bookingId)));
}
