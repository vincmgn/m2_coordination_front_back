import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import { connectDB, closeDB } from "./db.js";
import moviesRouter from "./routes/movies.js";

type AppError = Error & { status?: number; type?: string };

const app = express();
app.disable("x-powered-by");
app.use(express.json());

app.get("/", (_req: Request, res: Response) => {
  res.json({
    name: "API Movies (sample_mflix)",
    endpoints: [
      { method: "GET", path: "/movies", description: "Liste paginée", query: ["page", "limit (max 100)", "title", "year", "genre"] },
      { method: "GET", path: "/movies/genres", description: "Liste des genres distincts" },
      { method: "GET", path: "/movies/:id", description: "Un film par son _id" },
      { method: "POST", path: "/movies", description: "Créer un film (title obligatoire)" },
      { method: "PUT", path: "/movies/:id", description: "Modifier les champs envoyés" },
      { method: "DELETE", path: "/movies/:id", description: "Supprimer un film" },
    ],
  });
});

app.use("/movies", moviesRouter);

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: `Route introuvable : ${req.method} ${req.path}` });
});

app.use((err: AppError, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Corps JSON invalide" });
  }

  const status = err.status ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? "Erreur interne du serveur" : err.message });
});

const PORT = Number(process.env.PORT) || 3000;

try {
  await connectDB();
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
  console.log(`API démarrée sur http://localhost:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    server.close();
    await closeDB();
    process.exit(0);
  });
}
