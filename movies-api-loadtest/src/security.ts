import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./http-error.js";

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.set({
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  });
  next();
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (!UNSAFE.has(req.method)) return next();

  const site = req.get("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "Requête d'une autre origine refusée");

  const origin = req.get("Origin");
  if (origin && origin !== "null") {
    const host = req.get("X-Forwarded-Host") ?? req.get("Host");
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
    }
    if (!host || originHost !== host) throw new HttpError(403, "Requête d'une autre origine refusée");
  } else if (origin === "null") {
    throw new HttpError(403, "Requête d'une autre origine refusée");
  }

  const length = Number(req.get("Content-Length") ?? 0);
  if ((length > 0 || req.get("Transfer-Encoding")) && !req.is("application/json")) {
    throw new HttpError(415, "Le corps doit être en application/json");
  }
  next();
}

export function noStoreByDefault(_req: Request, res: Response, next: NextFunction) {
  res.set("Cache-Control", "no-store");
  next();
}

export const cleanText = (value: string) => value.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, "").replace(/\s+/g, " ").trim();
