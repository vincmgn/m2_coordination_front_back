import { createHash, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { getDB } from "../db.js";
import { HttpError } from "../http-error.js";
import { requireAdmin } from "./auth.js";

export const EXP = "bouton_reserver_v1";
const COOKIE = "ab_visitor";
const COOKIE_MAX_AGE_MS = 390 * 24 * 60 * 60 * 1000;
const SPLIT = 128;
const ATTRIBUTION_WINDOW_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const enabled = () => process.env.AB_ENABLED !== "false";

const PLAN = {
  hypothesis: "« Choisir cette place » augmente d'au moins 2 points le taux de réservations confirmées",
  metric: "navigateurs convertis / navigateurs exposés",
  baseline: 0.1,
  mde: 0.02,
  days: 14,
};
const MIN_PER_VARIANT = Math.ceil(Number(((16 * PLAN.baseline * (1 - PLAN.baseline)) / PLAN.mde ** 2).toFixed(6)));
const SRM_ALERT = 0.001;

type Variant = "A" | "B";

interface Assignment {
  _id: string;
  experiment: string;
  subjectId: string;
  variant: Variant;
  bucket: number;
  assignedAt: Date;
  exposed: boolean;
  exposedAt: Date | null;
  convertedAt: Date | null;
  bookings: number;
}

const assignments = () => getDB().collection<Assignment>("ab_assignments");

export async function ensureAbIndexes() {
  await assignments().createIndex({ experiment: 1, variant: 1 });
}

export function variantFor(experiment: string, subjectId: string) {
  const bucket = createHash("sha256").update(`${experiment}:${subjectId}`).digest()[0]!;
  return { bucket, variant: (bucket < SPLIT ? "A" : "B") as Variant };
}

function subjectFrom(req: Request) {
  const match = req.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return match && UUID_RE.test(match[1]!) ? match[1]!.toLowerCase() : null;
}

const router = Router();

router.get("/assignment", async (req: Request, res: Response) => {
  res.set("Cache-Control", "no-store");
  if (!enabled()) {
    res.json({ experiment: EXP, enabled: false, variant: "A" });
    return;
  }

  let subjectId = subjectFrom(req);
  if (!subjectId) {
    subjectId = randomUUID();
    res.cookie(COOKIE, subjectId, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: COOKIE_MAX_AGE_MS,
    });
  }

  const { bucket, variant } = variantFor(EXP, subjectId);
  const doc = await assignments().findOneAndUpdate(
    { _id: `${EXP}:${subjectId}` },
    {
      $setOnInsert: {
        experiment: EXP,
        subjectId,
        variant,
        bucket,
        assignedAt: new Date(),
        exposed: false,
        exposedAt: null,
        convertedAt: null,
        bookings: 0,
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  res.json({ experiment: EXP, enabled: true, variant: doc!.variant, bucket: doc!.bucket });
});

router.post("/exposure", async (req: Request, res: Response) => {
  if (!enabled()) throw new HttpError(409, "Expérience désactivée");
  const subjectId = subjectFrom(req);
  if (!subjectId) throw new HttpError(400, "Cookie ab_visitor absent : appelez d'abord /ab/assignment");

  const { matchedCount } = await assignments().updateOne(
    { _id: `${EXP}:${subjectId}`, exposed: false },
    { $set: { exposed: true, exposedAt: new Date() } },
  );
  if (!matchedCount && !(await assignments().countDocuments({ _id: `${EXP}:${subjectId}` }, { limit: 1 }))) {
    throw new HttpError(404, "Aucune affectation pour ce navigateur");
  }
  res.status(204).end();
});

export async function recordConversion(req: Request) {
  if (!enabled() || req.get("X-AB-Measure") !== "1") return;
  const subjectId = subjectFrom(req);
  if (!subjectId) return;
  const now = new Date();
  await assignments().updateOne(
    { _id: `${EXP}:${subjectId}`, exposed: true, exposedAt: { $gte: new Date(now.getTime() - ATTRIBUTION_WINDOW_MS) } },
    [{ $set: { convertedAt: { $ifNull: ["$convertedAt", now] }, bookings: { $add: ["$bookings", 1] } } }],
  );
}

function normalCdf(z: number) {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const erf = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

const round = (x: number, digits = 4) => Math.round(x * 10 ** digits) / 10 ** digits;

function srm(nA: number, nB: number) {
  const expected = (nA + nB) / 2;
  if (!expected) return null;
  const chi2 = ((nA - expected) ** 2 + (nB - expected) ** 2) / expected;
  return { chi2: round(chi2), pValue: round(2 * (1 - normalCdf(Math.sqrt(chi2)))) };
}

function compare(convA: number, nA: number, convB: number, nB: number) {
  if (!nA || !nB) return null;
  const pA = convA / nA;
  const pB = convB / nB;
  const diff = pB - pA;
  const seCi = Math.sqrt((pA * (1 - pA)) / nA + (pB * (1 - pB)) / nB);
  const pooled = (convA + convB) / (nA + nB);
  const seTest = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
  return {
    absolute: round(diff),
    relative: pA ? round(diff / pA) : null,
    ci95: [round(diff - 1.96 * seCi), round(diff + 1.96 * seCi)] as [number, number],
    pValue: seTest ? round(2 * (1 - normalCdf(Math.abs(diff / seTest)))) : null,
  };
}

router.get("/metrics", async (req: Request, res: Response) => {
  await requireAdmin(req);
  const rows = await assignments()
    .aggregate<{ _id: Variant; assigned: number; exposed: number; converted: number; bookings: number; firstExposure: Date | null }>([
      { $match: { experiment: EXP } },
      {
        $group: {
          _id: "$variant",
          assigned: { $sum: 1 },
          exposed: { $sum: { $cond: ["$exposed", 1, 0] } },
          converted: { $sum: { $cond: [{ $and: ["$exposed", { $ne: ["$convertedAt", null] }] }, 1, 0] } },
          bookings: { $sum: "$bookings" },
          firstExposure: { $min: "$exposedAt" },
        },
      },
    ])
    .toArray();

  const variants = (["A", "B"] as const).map((variant) => {
    const r = rows.find((row) => row._id === variant);
    const exposed = r?.exposed ?? 0;
    const converted = r?.converted ?? 0;
    return {
      variant,
      assigned: r?.assigned ?? 0,
      exposed,
      converted,
      bookings: r?.bookings ?? 0,
      rate: exposed ? round(converted / exposed) : null,
    };
  });
  const [a, b] = variants as [(typeof variants)[0], (typeof variants)[0]];

  const starts = rows.map((r) => r.firstExposure).filter((d): d is Date => d !== null);
  const start = starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null;
  const days = start ? Math.floor((Date.now() - start.getTime()) / (24 * 60 * 60 * 1000)) : 0;
  const ready = Math.min(a.exposed, b.exposed) >= MIN_PER_VARIANT && days >= PLAN.days;

  const balance = srm(a.exposed, b.exposed);
  const effect = compare(a.converted, a.exposed, b.converted, b.exposed);

  let decision: string;
  if (!ready) decision = "en cours : aucune conclusion avant la fin du plan";
  else if (balance && balance.pValue < SRM_ALERT) decision = "SRM : répartition déséquilibrée, chercher la cause, aucune conclusion";
  else if (!effect) decision = "données insuffisantes";
  else if (effect.ci95[0] > 0) decision = "déployer B, et suivre la métrique quelques semaines";
  else if (effect.ci95[0] > -PLAN.mde && effect.ci95[1] < PLAN.mde) decision = "abandonner B : pas d'effet utile, on garde A";
  else decision = "itérer : intervalle trop large ou B moins bon, changement plus marqué ou plus de trafic, nouvelle clé";

  res.json({
    experiment: EXP,
    enabled: enabled(),
    plan: { ...PLAN, minPerVariant: MIN_PER_VARIANT, start, daysElapsed: days, ready },
    variants,
    srm: balance,
    effect,
    decision,
  });
});

export default router;
