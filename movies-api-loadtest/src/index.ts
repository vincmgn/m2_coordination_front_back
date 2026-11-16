import "dotenv/config";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import express, { type NextFunction, type Request, type Response } from "express";
import { connectDB, closeDB } from "./db.js";
import { HttpError } from "./http-error.js";
import { csrfGuard, noStoreByDefault, securityHeaders } from "./security.js";
import abRouter, { ensureAbIndexes } from "./routes/ab.js";
import authRouter, { ensureAuthIndexes } from "./routes/auth.js";
import cinemasRouter, { cinemas } from "./routes/cinemas.js";
import { ensureCinemas } from "./geo/cinemas-seed.js";
import moviesRouter from "./routes/movies.js";
import screeningsRouter, { ensureScreeningIndexes } from "./routes/screenings.js";
import ticketsRouter from "./routes/tickets.js";
import { seedTpDemo } from "./tp-demo.js";

type AppError = Error & { status?: number; type?: string };

const APP_VERSION = process.env.APP_VERSION ?? "dev";
const ARTIFICIAL_DELAY_MS = Number(process.env.ARTIFICIAL_DELAY_MS) || 0;

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", "loopback, linklocal, uniquelocal");
app.use(securityHeaders);
app.use(noStoreByDefault);
app.use(csrfGuard);
app.use(express.json({ limit: "16kb", strict: true }));

app.use((_req: Request, res: Response, next: NextFunction) => {
  const ctx = trace.getActiveSpan()?.spanContext();
  if (ctx && trace.isSpanContextValid(ctx)) res.set("X-Trace-Id", ctx.traceId);
  next();
});

if (ARTIFICIAL_DELAY_MS > 0) {
  console.warn(`Ralentissement artificiel de ${ARTIFICIAL_DELAY_MS} ms par requête (simulation de régression)`);
  app.use((_req: Request, _res: Response, next: NextFunction) => {
    setTimeout(next, ARTIFICIAL_DELAY_MS);
  });
}

app.get("/", (_req: Request, res: Response) => {
  res.json({
    name: "API Movies (sample_mflix)",
    version: APP_VERSION,
    endpoints: [
      { method: "GET", path: "/movies", description: "Liste paginée", query: ["page", "limit (max 100)", "title", "year", "genre"] },
      { method: "GET", path: "/movies/search?q=", description: "Recherche par titre, genre ou année (2 à 60 caractères, 20 résultats max)" },
      { method: "GET", path: "/movies/genres", description: "Liste des genres distincts" },
      { method: "GET", path: "/movies/:id", description: "Un film par son _id" },
      { method: "POST", path: "/movies", description: "Créer un film (title obligatoire)" },
      { method: "PUT", path: "/movies/:id", description: "Modifier les champs envoyés" },
      { method: "DELETE", path: "/movies/:id", description: "Supprimer un film" },
      { method: "POST", path: "/auth/register", description: "Créer un compte { email, password, name } et se connecter" },
      { method: "POST", path: "/auth/login", description: "Se connecter { email, password } (cookie session)" },
      { method: "POST", path: "/auth/logout", description: "Se déconnecter" },
      { method: "GET", path: "/auth/me", description: "Utilisateur connecté (401 sinon)" },
      { method: "GET", path: "/screenings/mine", description: "Mes séances : réservations du compte connecté" },
      { method: "GET", path: "/screenings/mine/:bookingId/ticket.pdf", description: "Billet PDF d'une réservation (inline ; ?download=true : attachment)" },
      { method: "GET", path: "/screenings?movieId=", description: "Séances à venir d'un film et places libres" },
      { method: "GET", path: "/screenings/:id", description: "Plan de salle et sièges réservés" },
      { method: "GET", path: "/screenings/:id/events", description: "Flux SSE : sièges réservés / libérés en direct" },
      { method: "POST", path: "/screenings/:id/reservations", description: "Réserver des sièges { seats, name }" },
      { method: "DELETE", path: "/screenings/:id/reservations/:bookingId", description: "Annuler une réservation" },
      { method: "GET", path: "/cinemas", description: "Annuaire des cinémas (page, limit, feature = vo | imax | pmr)" },
      { method: "GET", path: "/cinemas?lat=&lon=&radiusKm=", description: "Cinémas à moins de radiusKm km (5 par défaut, 20 max), du plus proche au plus loin" },
      { method: "GET", path: "/ab/assignment", description: "Test A/B : variante du navigateur (cookie ab_visitor)" },
      { method: "POST", path: "/ab/exposure", description: "Test A/B : le bouton testé a été vu (une fois par navigateur)" },
      { method: "GET", path: "/ab/metrics", description: "Test A/B : effectifs, SRM, écart, intervalle de confiance, décision" },
    ],
  });
});

app.use("/movies", moviesRouter);
app.use("/screenings", ticketsRouter);
app.use("/screenings", screeningsRouter);
app.use("/cinemas", cinemasRouter);
app.use("/ab", abRouter);
app.use("/auth", authRouter);

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: `Route introuvable : ${req.method} ${req.path.slice(0, 100)}` });
});

app.use((err: AppError, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Corps JSON invalide" });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Corps de requête trop volumineux" });
  }

  const status = err.status ?? 500;
  const unexpected = status >= 500 && !(err instanceof HttpError);
  if (unexpected) {
    console.error(err);
    const span = trace.getActiveSpan();
    span?.recordException(err);
    span?.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
  }
  res.status(status).json({ error: unexpected ? "Erreur interne du serveur" : err.message });
});

const PORT = Number(process.env.PORT) || 3000;

try {
  await connectDB();
  await ensureScreeningIndexes();
  await ensureAbIndexes();
  await ensureAuthIndexes();
  await ensureCinemas(cinemas());
  await seedTpDemo();
} catch (err) {
  console.error("Connexion à MongoDB impossible :", (err as Error).message);
  process.exit(1);
}

const server = app.listen(PORT, (error) => {
  if (error) {
    console.error(`Impossible d'écouter sur le port ${PORT} :`, error.message);
    process.exit(1);
  }
  console.log(`API ${APP_VERSION} démarrée sur http://localhost:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    server.close();
    await closeDB();
    process.exit(0);
  });
}
