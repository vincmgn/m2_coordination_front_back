import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Router, type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../db.js";
import { HttpError } from "../http-error.js";
import { clientIp, rateLimiter } from "../rate-limit.js";
import { cleanText } from "../security.js";

// Authentification volontairement simple : e-mail + mot de passe, session côté serveur.
//
// Mot de passe : haché avec scrypt (sel aléatoire par compte), jamais stocké en clair.
// Session : jeton aléatoire (256 bits) dans un cookie httpOnly « session », SameSite=Strict. La base ne garde que
// l'empreinte SHA-256 du jeton et sa date d'expiration (index TTL) : une fuite de la base ne donne aucune session.
// Force brute : connexions limitées par IP et par e-mail, inscriptions par IP. Une connexion avec un e-mail inconnu
// coûte le même calcul scrypt qu'un mot de passe faux : le temps de réponse ne dit pas si le compte existe.
// Administration : les comptes dont l'e-mail figure dans ADMIN_EMAILS (liste séparée par des virgules) peuvent
// créer, modifier et supprimer des films. Aucun compte n'est administrateur par défaut.
// Le front et l'API partagent l'origine (proxy /api) : le cookie part avec chaque appel, sans CORS.

const COOKIE = "session";
const MAX_PASSWORD = 200;
const SESSION_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours
const MIN_PASSWORD = 8;

interface User {
  _id: ObjectId;
  email: string;
  name: string;
  passwordHash: string; // <sel hex>:<clé dérivée hex>
  createdAt: Date;
}

interface Session {
  token: string;
  userId: ObjectId;
  expiresAt: Date;
}

const users = () => getDB().collection<User>("users");
const sessions = () => getDB().collection<Session>("sessions");
const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export async function ensureAuthIndexes() {
  await users().createIndex({ email: 1 }, { unique: true });
  await sessions().createIndex({ token: 1 }, { unique: true });
  await sessions().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string) {
  const [salt, key] = stored.split(":");
  const expected = Buffer.from(key!, "hex");
  const actual = await scryptAsync(password, Buffer.from(salt!, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

const tokenFrom = (req: Request) => req.headers.cookie?.match(/(?:^|;\s*)session=([0-9a-f]{64})(?:;|$)/)?.[1] ?? null;
const digest = (token: string) => createHash("sha256").update(token).digest("hex");

const adminEmails = () =>
  new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
export const isAdmin = (u: Pick<User, "email">) => adminEmails().has(u.email);

const publicUser = (u: Pick<User, "_id" | "email" | "name">) => ({ id: u._id, email: u.email, name: u.name, admin: isAdmin(u) });

// Utilisateur connecté, ou null. Utilisable par les autres routes (réservation, « Mes séances »).
export async function currentUser(req: Request) {
  const token = tokenFrom(req);
  if (!token) return null;
  const session = await sessions().findOne({ token: digest(token), expiresAt: { $gt: new Date() } });
  if (!session) return null;
  return users().findOne({ _id: session.userId }, { projection: { email: 1, name: 1 } });
}

export async function requireUser(req: Request) {
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, "Connexion requise");
  return user;
}

// Réservé aux administrateurs (ADMIN_EMAILS) : 401 sans session, 403 pour un compte ordinaire.
export async function requireAdmin(req: Request) {
  const user = await requireUser(req);
  if (!isAdmin(user)) throw new HttpError(403, "Action réservée aux administrateurs");
  return user;
}

async function openSession(res: Response, userId: ObjectId) {
  const token = randomBytes(32).toString("hex");
  await sessions().insertOne({ token: digest(token), userId, expiresAt: new Date(Date.now() + SESSION_MS) });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    // Secure exige HTTPS ; en dev l'API est servie en HTTP derrière le proxy Vite.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MS,
  });
}

function parseCredentials(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Le champ "email" est requis et doit être valide');
  const password = typeof b.password === "string" ? b.password : "";
  if (!password || password.length > MAX_PASSWORD) throw new HttpError(400, 'Le champ "password" est requis');
  return { email, password };
}

const router = Router();

// Hachage factice : une connexion avec un e-mail inconnu fait le même calcul qu'un mot de passe faux.
const DUMMY_HASH = hashPassword(randomBytes(16).toString("hex"));

const loginByIp = rateLimiter({ max: 20, windowMs: 60_000 });
const loginByEmail = rateLimiter({ max: 10, windowMs: 15 * 60_000 });
const registerByIp = rateLimiter({ max: 5, windowMs: 60 * 60_000 });
export const resetAuthLimits = () => [loginByIp, loginByEmail, registerByIp].forEach((l) => l.reset());

// POST /auth/register { email, password, name } : crée le compte et connecte directement.
router.post("/register", async (req, res) => {
  registerByIp.check(clientIp(req), res, "Trop de comptes créés depuis cette adresse. Réessayez plus tard.");
  const { email, password } = parseCredentials(req.body);
  if (password.length < MIN_PASSWORD) throw new HttpError(400, `Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères`);
  const name = typeof req.body?.name === "string" ? cleanText(req.body.name) : "";
  if (!name || name.length > 60) throw new HttpError(400, 'Le champ "name" est requis (60 caractères maximum)');

  const user = { _id: new ObjectId(), email, name, passwordHash: await hashPassword(password), createdAt: new Date() };
  try {
    await users().insertOne(user);
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw new HttpError(409, "Un compte existe déjà avec cet e-mail");
    throw e;
  }
  await openSession(res, user._id);
  res.status(201).json(publicUser(user));
});

// POST /auth/login { email, password } : même message d'erreur que l'e-mail ou le mot de passe soit faux.
router.post("/login", async (req, res) => {
  const tooMany = "Trop de tentatives de connexion. Réessayez dans quelques minutes.";
  loginByIp.check(clientIp(req), res, tooMany);
  const { email, password } = parseCredentials(req.body);
  loginByEmail.check(email, res, tooMany);
  const user = await users().findOne({ email });
  const valid = await verifyPassword(password, user?.passwordHash ?? (await DUMMY_HASH));
  if (!user || !valid) throw new HttpError(401, "E-mail ou mot de passe incorrect");
  await openSession(res, user._id);
  res.json(publicUser(user));
});

// POST /auth/logout : supprime la session en base et le cookie.
router.post("/logout", async (req, res) => {
  const token = tokenFrom(req);
  if (token) await sessions().deleteOne({ token: digest(token) });
  res.clearCookie(COOKIE, { path: "/", httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" });
  res.status(204).end();
});

// GET /auth/me : utilisateur connecté (401 sinon).
router.get("/me", async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(publicUser(await requireUser(req)));
});

export default router;
