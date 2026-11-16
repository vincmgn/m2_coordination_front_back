import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./http-error.js";

// Défenses transverses de l'API (appliquées dans index.ts avant toutes les routes).

// En-têtes de sécurité : l'API ne sert que du JSON, des PDF et un flux SSE, jamais de page à afficher.
// CSP « rien » : même si une réponse était interprétée comme du HTML, aucun script ni ressource ne se chargerait.
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

// Protection CSRF, en plus du cookie SameSite=Strict :
// - toute requête qui modifie doit venir de la même origine. Le navigateur l'indique (Sec-Fetch-Site, Origin) et
//   un site tiers ne peut pas falsifier ces en-têtes. SameSite ne suffit pas : http://localhost:<autre port>
//   est « même site », donc une autre application locale pourrait envoyer le cookie ;
// - un corps doit être en application/json : un formulaire HTML ne sait pas l'envoyer sans CORS, que l'API n'ouvre pas.
// Les clients hors navigateur (curl, k6, tests) n'envoient ni Origin ni Sec-Fetch-Site : ils passent, sans cookie volé.
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (!UNSAFE.has(req.method)) return next();

  const site = req.get("Sec-Fetch-Site");
  if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "Requête d'une autre origine refusée");

  const origin = req.get("Origin");
  if (origin && origin !== "null") {
    // Hôte vu par le navigateur : X-Forwarded-Host posé par nginx / Vite, sinon Host.
    const host = req.get("X-Forwarded-Host") ?? req.get("Host");
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      /* origine illisible : refusée ci-dessous */
    }
    if (!host || originHost !== host) throw new HttpError(403, "Requête d'une autre origine refusée");
  } else if (origin === "null") {
    throw new HttpError(403, "Requête d'une autre origine refusée"); // iframe sandbox, data:, fichier local
  }

  const length = Number(req.get("Content-Length") ?? 0);
  if ((length > 0 || req.get("Transfer-Encoding")) && !req.is("application/json")) {
    throw new HttpError(415, "Le corps doit être en application/json");
  }
  next();
}

// Réponses de l'API : jamais en cache par défaut (données de compte, réservations).
// Les routes publiques et stables pourraient l'assouplir explicitement.
export function noStoreByDefault(_req: Request, res: Response, next: NextFunction) {
  res.set("Cache-Control", "no-store");
  next();
}

// Retire les caractères de contrôle et de direction (U+202E « RTL override »…) d'un texte saisi :
// ils servent à maquiller un nom (inverser l'affichage de « exe.pdf ») dans un billet, un SMS ou une liste.
export const cleanText = (value: string) => value.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, "").replace(/\s+/g, " ").trim();
