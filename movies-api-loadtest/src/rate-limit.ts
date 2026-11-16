import type { Request } from "express";
import { HttpError } from "./http-error.js";

// Limite de fréquence en mémoire, à fenêtre glissante : `max` actions par `windowMs` et par clé (IP, compte, e-mail…).
// Suffisant avec une seule instance de l'API ; avec plusieurs, il faudrait un compteur partagé (Redis…).
// Au-delà : 429 + Retry-After. Les clés inactives sont purgées pour borner la mémoire.

export const TOO_MANY = "Trop de demandes en peu de temps. Réessayez dans quelques instants.";

export function rateLimiter({ max, windowMs }: { max: number; windowMs: number }) {
  const hits = new Map<string, number[]>();
  let lastSweep = Date.now();

  // Renvoie 0 si l'action est permise (et la compte), sinon le nombre de secondes à attendre.
  function take(key: string, now = Date.now()) {
    if (now - lastSweep > windowMs) {
      for (const [k, list] of hits) if (now - list[list.length - 1]! >= windowMs) hits.delete(k);
      lastSweep = now;
    }
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return Math.max(1, Math.ceil((recent[0]! + windowMs - now) / 1000));
    }
    recent.push(now);
    hits.set(key, recent);
    return 0;
  }

  // Lève 429 (avec Retry-After posé sur la réponse) si la clé a épuisé son quota.
  function check(key: string, res: { set(name: string, value: string): unknown }, message = TOO_MANY) {
    const wait = take(key);
    if (wait) {
      res.set("Retry-After", String(wait));
      throw new HttpError(429, message);
    }
  }

  return { take, check, reset: () => hits.clear() };
}

// Adresse du client. Derrière nginx, Express lit X-Forwarded-For grâce à `trust proxy` (cf. index.ts),
// limité aux réseaux privés : un client direct ne peut pas usurper son adresse avec cet en-tête.
export const clientIp = (req: Request) => req.ip ?? req.socket.remoteAddress ?? "inconnu";
