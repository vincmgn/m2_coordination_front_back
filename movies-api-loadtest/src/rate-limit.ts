import type { Request } from "express";
import { HttpError } from "./http-error.js";

export const TOO_MANY = "Trop de demandes en peu de temps. Réessayez dans quelques instants.";

export function rateLimiter({ max, windowMs }: { max: number; windowMs: number }) {
  const hits = new Map<string, number[]>();
  let lastSweep = Date.now();

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

  function check(key: string, res: { set(name: string, value: string): unknown }, message = TOO_MANY) {
    const wait = take(key);
    if (wait) {
      res.set("Retry-After", String(wait));
      throw new HttpError(429, message);
    }
  }

  return { take, check, reset: () => hits.clear() };
}

export const clientIp = (req: Request) => req.ip ?? req.socket.remoteAddress ?? "inconnu";
