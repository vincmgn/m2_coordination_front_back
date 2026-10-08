import { MongoClient, type Db } from "mongodb";

let client: MongoClient | undefined;
let db: Db | undefined;

export async function connectDB(): Promise<Db> {
  if (db) return db;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI est absente : copiez .env.example vers .env et renseignez-la.");
  }

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(process.env.MONGODB_DB || "sample_mflix");
  return db;
}

export function getDB(): Db {
  if (!db) throw new Error("Base non connectée : appelez connectDB() au démarrage.");
  return db;
}

export async function closeDB(): Promise<void> {
  await client?.close();
  client = undefined;
  db = undefined;
}
