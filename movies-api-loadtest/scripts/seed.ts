// Remplit une base MongoDB LOCALE avec des films factices au format sample_mflix (utilisé par la CI).
// Lancement : MONGODB_URI=mongodb://localhost:27017 npm run seed
// Volontairement sans dotenv : le .env (Atlas) n'est jamais lu ici.
import { MongoClient } from "mongodb";

const COUNT = 21349; // même volume que sample_mflix.movies
const uri = process.env.MONGODB_URI ?? "";
const dbName = process.env.MONGODB_DB || "sample_mflix";

// Le script vide la collection : on refuse tout ce qui n'est pas une base locale.
const host = uri.match(/^mongodb:\/\/(?:[^@/]*@)?([^:/?]+)/)?.[1];
if (!host || !["localhost", "127.0.0.1"].includes(host)) {
  console.error("Refusé : le seed ne s'exécute que sur une base locale (mongodb://localhost:...).");
  process.exit(1);
}

// Générateur pseudo-aléatoire à graine fixe : mêmes données à chaque exécution, donc runs comparables.
let state = 42;
const random = () => ((state = (state * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)];

const WORDS = ["Star", "Love", "Night", "Man", "War", "City", "Dark", "Last", "Blue", "King", "Road", "Ghost", "Summer", "Island", "Dream"];
const GENRES = ["Drama", "Comedy", "Action", "Western", "Horror", "Romance", "Thriller", "Crime", "Sci-Fi", "Adventure", "Short"];

const movies = Array.from({ length: COUNT }, (_, i) => ({
  title: `The ${pick(WORDS)} ${pick(WORDS)} ${i}`,
  year: 1900 + Math.floor(random() * 121),
  genres: [...new Set([pick(GENRES), pick(GENRES), pick(GENRES)])].slice(0, 1 + Math.floor(random() * 3)),
  plot: "Film factice généré pour les tests de charge.",
  ...(random() < 0.8 && { poster: `https://example.com/posters/${i}.jpg` }),
  imdb: { rating: Math.round((1 + random() * 9) * 10) / 10, votes: Math.floor(random() * 100000) },
}));

const client = new MongoClient(uri);
try {
  await client.connect();
  const collection = client.db(dbName).collection("movies");
  await collection.deleteMany({});
  await collection.insertMany(movies);
  console.log(`${COUNT} films insérés dans ${dbName}.movies (${host})`);
} finally {
  await client.close();
}
