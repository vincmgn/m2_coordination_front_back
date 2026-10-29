import { createHash, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { getDB } from "../db.js";
import { HttpError } from "../http-error.js";

// Test A/B du libellé du bouton de réservation (cours A/B testing, chap. 3).
//   A (contrôle)    « Réserver »
//   B (traitement)  « Choisir cette place »  — seul le texte change : même couleur, même place, même action.
//
// Rôles :
//   back   affecte la variante (SHA-256 de « clé:identifiant »), déduplique l'exposition, enregistre la conversion
//   front  affiche la variante reçue et signale l'exposition quand le bouton est vu ; il n'envoie jamais
//          ni sa variante ni la conversion
// Unité de randomisation : le navigateur, via un cookie opaque ab_visitor (UUID).
// Un document par (expérience, navigateur) dans ab_assignments : affecté → exposé → converti.

export const EXP = "bouton_reserver_v1"; // une nouvelle version du test = une nouvelle clé
const COOKIE = "ab_visitor";
const COOKIE_MAX_AGE_MS = 390 * 24 * 60 * 60 * 1000; // < 13 mois (CNIL), posé une fois, jamais prolongé
const SPLIT = 128; // seaux 0-127 → A, 128-255 → B
const ATTRIBUTION_WINDOW_MS = 24 * 60 * 60 * 1000; // une réservation compte si elle suit l'exposition de moins de 24 h
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Interrupteur : AB_ENABLED=false remet tout le monde sur A sans redéployer le front. Les données restent.
const enabled = () => process.env.AB_ENABLED !== "false";

// Fiche d'expérience (cours p. 56), fixée AVANT le lancement.
// Taille : n ≈ 16 × p × (1 − p) / δ² par version (α = 5 %, puissance 80 %), p = taux actuel, δ = effet visé.
// Durée : en semaines entières, à recalculer avec le trafic réel (navigateurs exposés par jour).
const PLAN = {
  hypothesis: "« Choisir cette place » augmente d'au moins 2 points le taux de réservations confirmées",
  metric: "navigateurs convertis / navigateurs exposés",
  baseline: 0.1,
  mde: 0.02,
  days: 14,
};
// toFixed : 16 × 0,09 / 0,0004 vaut 3600,0000000000005 en virgule flottante, ceil donnerait 3 601.
const MIN_PER_VARIANT = Math.ceil(Number(((16 * PLAN.baseline * (1 - PLAN.baseline)) / PLAN.mde ** 2).toFixed(6))); // 3 600
const SRM_ALERT = 0.001;

type Variant = "A" | "B";

interface Assignment {
  _id: string; // `${EXP}:${subjectId}`
  experiment: string;
  subjectId: string;
  variant: Variant;
  bucket: number;
  assignedAt: Date;
  exposed: boolean;
  exposedAt: Date | null;
  convertedAt: Date | null; // première réservation attribuée : le navigateur compte une seule fois
  bookings: number; // réservations attribuées (information, pas la métrique)
}

const assignments = () => getDB().collection<Assignment>("ab_assignments");

export async function ensureAbIndexes() {
  await assignments().createIndex({ experiment: 1, variant: 1 });
}

// Même entrée, même seau : la version est stable d'un rechargement à l'autre et sur tous les serveurs.
// La clé dans le calcul rend les expériences indépendantes entre elles.
export function variantFor(experiment: string, subjectId: string) {
  const bucket = createHash("sha256").update(`${experiment}:${subjectId}`).digest()[0]!; // octet non signé, 0 à 255
  return { bucket, variant: (bucket < SPLIT ? "A" : "B") as Variant };
}

// Identifiant du navigateur lu dans le cookie ; jamais une valeur libre.
function subjectFrom(req: Request) {
  const match = req.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return match && UUID_RE.test(match[1]!) ? match[1]!.toLowerCase() : null;
}

const router = Router();

// GET /ab/assignment : variante du navigateur. Pose le cookie à la première visite seulement.
router.get("/assignment", async (req: Request, res: Response) => {
  res.set("Cache-Control", "no-store"); // jamais en cache partagé : sinon tout le monde reçoit la même variante
  if (!enabled()) {
    res.json({ experiment: EXP, enabled: false, variant: "A" });
    return;
  }

  let subjectId = subjectFrom(req);
  if (!subjectId) {
    subjectId = randomUUID();
    res.cookie(COOKIE, subjectId, {
      httpOnly: true,
      sameSite: "lax",
      // Secure exige HTTPS ; en dev l'API est servie en HTTP derrière le proxy Vite.
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: COOKIE_MAX_AGE_MS,
    });
  }

  // Le document existant est gardé tel quel : un navigateur déjà affecté garde sa version.
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

// POST /ab/exposure : le bouton testé a été vu. Une seule exposition par navigateur, première date conservée.
// Le corps est ignoré : la variante est celle du document, le client ne peut pas la choisir.
router.post("/exposure", async (req: Request, res: Response) => {
  if (!enabled()) throw new HttpError(409, "Expérience désactivée");
  const subjectId = subjectFrom(req);
  if (!subjectId) throw new HttpError(400, "Cookie ab_visitor absent : appelez d'abord /ab/assignment");

  // Une seule écriture conditionnelle (pas de lecture puis écriture) : deux appels simultanés ne comptent qu'une fois.
  const { matchedCount } = await assignments().updateOne(
    { _id: `${EXP}:${subjectId}`, exposed: false },
    { $set: { exposed: true, exposedAt: new Date() } },
  );
  if (!matchedCount && !(await assignments().countDocuments({ _id: `${EXP}:${subjectId}` }, { limit: 1 }))) {
    throw new HttpError(404, "Aucune affectation pour ce navigateur");
  }
  res.status(204).end();
});

// Appelée par la route de réservation, APRÈS l'enregistrement réussi (un 409 n'arrive jamais ici).
// Attribuée seulement si le navigateur a été exposé dans les 24 h ; convertedAt n'est posé qu'une fois.
export async function recordConversion(req: Request) {
  if (!enabled() || req.get("X-AB-Measure") !== "1") return; // mode de secours du front : pas d'attribution
  const subjectId = subjectFrom(req);
  if (!subjectId) return;
  const now = new Date();
  await assignments().updateOne(
    { _id: `${EXP}:${subjectId}`, exposed: true, exposedAt: { $gte: new Date(now.getTime() - ATTRIBUTION_WINDOW_MS) } },
    [{ $set: { convertedAt: { $ifNull: ["$convertedAt", now] }, bookings: { $add: ["$bookings", 1] } } }],
  );
}

// --- Analyse (cours chap. 4) ---------------------------------------------------------------------

// Fonction de répartition de la loi normale centrée réduite (approximation d'Abramowitz et Stegun, erreur < 1e-7).
function normalCdf(z: number) {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const erf = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

const round = (x: number, digits = 4) => Math.round(x * 10 ** digits) / 10 ** digits;

// SRM : khi-deux d'adéquation à 50/50 sur les exposés (1 degré de liberté, p = 2 × (1 − Φ(√χ²))).
function srm(nA: number, nB: number) {
  const expected = (nA + nB) / 2;
  if (!expected) return null;
  const chi2 = ((nA - expected) ** 2 + (nB - expected) ** 2) / expected;
  return { chi2: round(chi2), pValue: round(2 * (1 - normalCdf(Math.sqrt(chi2)))) };
}

// Écart B − A : intervalle de confiance à 95 % (non poolé) et p-value du test z de deux proportions (poolé).
function compare(convA: number, nA: number, convB: number, nB: number) {
  if (!nA || !nB) return null;
  const pA = convA / nA;
  const pB = convB / nB;
  const diff = pB - pA;
  const seCi = Math.sqrt((pA * (1 - pA)) / nA + (pB * (1 - pB)) / nB);
  const pooled = (convA + convB) / (nA + nB);
  const seTest = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
  return {
    absolute: round(diff), // en proportion : 0,02 = 2 points
    relative: pA ? round(diff / pA) : null,
    ci95: [round(diff - 1.96 * seCi), round(diff + 1.96 * seCi)] as [number, number],
    pValue: seTest ? round(2 * (1 - normalCdf(Math.abs(diff / seTest)))) : null,
  };
}

// GET /ab/metrics : effectifs par variante, puis contrôle SRM, écart, et décision selon la règle de la fiche.
router.get("/metrics", async (_req: Request, res: Response) => {
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
      rate: exposed ? round(converted / exposed) : null, // pas de taux inventé sans exposé
    };
  });
  const [a, b] = variants as [(typeof variants)[0], (typeof variants)[0]];

  const starts = rows.map((r) => r.firstExposure).filter((d): d is Date => d !== null);
  const start = starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null;
  const days = start ? Math.floor((Date.now() - start.getTime()) / (24 * 60 * 60 * 1000)) : 0;
  const ready = Math.min(a.exposed, b.exposed) >= MIN_PER_VARIANT && days >= PLAN.days;

  const balance = srm(a.exposed, b.exposed);
  const effect = compare(a.converted, a.exposed, b.converted, b.exposed);

  // Arbre de décision du cours (p. 55), appliqué seulement à la date de fin : pas de regard quotidien.
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
