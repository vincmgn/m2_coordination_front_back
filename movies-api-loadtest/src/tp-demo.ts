import { ObjectId } from "mongodb";
import { getDB } from "./db.js";
import { hashPassword } from "./routes/auth.js";
import { TP_TICKETS } from "./tp.js";

export const DEMO_EMAIL = "spectateur@movies.test";
const DEMO_PASSWORD = "Movies-demo-2026!";
const BOOKINGS = 24;
const SMS_REFUSED = new Set([4, 11, 19]);
const TIMES = ["1400", "1730", "2100"];

const ymd = (d: Date) => d.toISOString().slice(0, 10).replaceAll("-", "");

export async function seedTpDemo() {
  if (!TP_TICKETS) return;
  const db = getDB();
  if (await db.collection("users").findOne({ email: DEMO_EMAIL })) return;

  const { insertedId: userId } = await db.collection("users").insertOne({
    email: DEMO_EMAIL,
    name: "Camille Dupont",
    passwordHash: await hashPassword(DEMO_PASSWORD),
    createdAt: new Date(),
  });

  const films = await db
    .collection("movies")
    .find({ poster: { $exists: true }, "imdb.rating": { $gte: 7.5 } }, { projection: { _id: 1 } })
    .limit(BOOKINGS)
    .toArray();

  const rows = films.flatMap((film, i) => {
    const day = new Date(Date.now() + (i - 20) * 86_400_000);
    const screeningId = `${String(film._id)}-${ymd(day)}-${TIMES[i % TIMES.length]}`;
    const bookingId = new ObjectId();
    const createdAt = new Date(day.getTime() - 3 * 86_400_000);
    const refused = SMS_REFUSED.has(i);
    const phone = refused ? "0611223313" : "0612345678";
    return ["E5", "E6"].slice(0, 1 + (i % 2)).map((seat) => ({
      screeningId,
      seat,
      name: "Camille Dupont",
      email: DEMO_EMAIL,
      phone,
      bookingId,
      userId,
      createdAt,
      smsStatus: refused ? "FAILED" : "SENT",
      smsAt: new Date(createdAt.getTime() + 1500),
    }));
  });
  if (rows.length) await db.collection("reservations").insertMany(rows, { ordered: false }).catch(() => {});
  console.log(`TP OpenTelemetry : compte de démonstration ${DEMO_EMAIL} créé (${films.length} réservations)`);
}
