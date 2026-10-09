import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import { connectDB, closeDB } from "./db.js";
import { HttpError } from "./http-error.js";
import moviesRouter from "./routes/movies.js";
import screeningsRouter, { ensureScreeningIndexes } from "./routes/screenings.js";

type AppError = Error & { status?: number; type?: string };

// Version déployée (fixée dans l'image Docker au build), affichée sur GET / pour vérifier un déploiement ou un rollback.
const APP_VERSION = process.env.APP_VERSION ?? "dev";
// Ralentissement artificiel, uniquement pour simuler une version défectueuse (démo de rollback). 0 par défaut.
const ARTIFICIAL_DELAY_MS = Number(process.env.ARTIFICIAL_DELAY_MS) || 0;

const app = express();
app.disable("x-powered-by");
app.use(express.json());

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
      { method: "GET", path: "/screenings?movieId=", description: "Séances à venir d'un film et places libres" },
      { method: "GET", path: "/screenings/:id", description: "Plan de salle et sièges réservés" },
      { method: "GET", path: "/screenings/:id/events", description: "Flux SSE : sièges réservés / libérés en direct" },
      { method: "POST", path: "/screenings/:id/reservations", description: "Réserver des sièges { seats, name }" },
      { method: "DELETE", path: "/screenings/:id/reservations/:bookingId", description: "Annuler une réservation" },
    ],
  });
});

app.use("/movies", moviesRouter);
app.use("/screenings", screeningsRouter);

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: `Route introuvable : ${req.method} ${req.path}` });
});

app.use((err: AppError, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Corps JSON invalide" });
  }

  const status = err.status ?? 500;
  // Une HttpError est une réponse voulue (ex. 503 simulé) : son message est montré tel quel.
  // Toute autre erreur 5xx est un bug : on la journalise et on masque ses détails.
  const unexpected = status >= 500 && !(err instanceof HttpError);
  if (unexpected) console.error(err);
  res.status(status).json({ error: unexpected ? "Erreur interne du serveur" : err.message });
});

const PORT = Number(process.env.PORT) || 3000;

try {
  await connectDB();
  await ensureScreeningIndexes();
} catch (err) {
  console.error("Connexion à MongoDB impossible :", (err as Error).message);
  process.exit(1);
}

// Express 5 passe au callback l'éventuelle erreur d'écoute (port déjà utilisé…).
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
