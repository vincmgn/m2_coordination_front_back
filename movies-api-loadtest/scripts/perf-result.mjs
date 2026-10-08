// Interprète un lancement k6 : statut (ok / seuil / technique), mesures, seuils et contexte du run.
// Écrit result.json (lu ensuite pour le suivi des tickets) et affiche un résumé Markdown.
// Usage : node scripts/perf-result.mjs <summary.json> <code de sortie k6 | vide si k6 n'a pas tourné> <result.json>
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [summaryPath, exitCodeArg, outputPath] = process.argv.slice(2);
const env = process.env;

const THRESHOLD_METRICS = {
  http_req_duration: "Temps de réponse",
  http_req_failed: "Erreurs HTTP",
  checks: "Contrôles fonctionnels",
};

function readSummary() {
  if (!existsSync(summaryPath)) return { error: "résumé k6 absent" };
  try {
    const { metrics } = JSON.parse(readFileSync(summaryPath, "utf8"));
    if (!metrics?.http_reqs?.count) return { error: "résumé k6 sans aucune requête mesurée" };
    return { metrics };
  } catch (e) {
    return { error: `résumé k6 illisible (${e.message})` };
  }
}

const exitCode = exitCodeArg === "" || exitCodeArg === undefined ? null : Number(exitCodeArg);
const { metrics, error } = readSummary();

// Seuils attendus et seuils dépassés (dans l'export k6, true = seuil dépassé).
const thresholds = [];
for (const [metric, label] of Object.entries(THRESHOLD_METRICS)) {
  for (const [threshold, crossed] of Object.entries(metrics?.[metric]?.thresholds ?? {})) {
    thresholds.push({ metric, label, threshold, crossed });
  }
}

// 0 = seuils respectés, 99 = seuil dépassé. Tout le reste (k6 absent, API injoignable, script cassé)
// ou un résumé inexploitable ne permet pas de conclure sur les performances.
let status;
let reason;
if (exitCode === null) [status, reason] = ["technique", "k6 n'a pas été lancé (API non disponible ?)"];
else if (exitCode !== 0 && exitCode !== 99) [status, reason] = ["technique", `k6 s'est arrêté avec le code ${exitCode}`];
else if (error) [status, reason] = ["technique", error];
else if (exitCode === 99 || thresholds.some((t) => t.crossed)) [status, reason] = ["seuil", "au moins un seuil dépassé"];
else [status, reason] = ["ok", "tous les seuils sont respectés"];

const runUrl = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
const result = {
  status,
  reason,
  route: env.PERF_ROUTE,
  scenario: { script: env.PERF_SCRIPT, vus: Number(env.VUS), duration: env.DURATION },
  measures: metrics && {
    requests: metrics.http_reqs.count,
    rate_per_s: Math.round(metrics.http_reqs.rate),
    p95_ms: Math.round(metrics.http_req_duration["p(95)"]),
    error_rate_pct: Number(((metrics.http_req_failed?.value ?? 0) * 100).toFixed(2)),
    checks_pct: Number(((metrics.checks?.value ?? 0) * 100).toFixed(2)),
  },
  thresholds,
  revision: env.GITHUB_SHA,
  environment: `GitHub Actions (${env.ImageOS ?? env.RUNNER_OS ?? "local"}), API Node.js + MongoDB jetable (${env.SEED_COUNT ?? "?"} films factices)`,
  event: env.GITHUB_EVENT_NAME,
  run_url: runUrl,
  date: new Date().toISOString(),
};
writeFileSync(outputPath, JSON.stringify(result, null, 2));

const icon = { ok: "✅", seuil: "❌", technique: "⚠️" }[status];
const m = result.measures;
console.log(`## ${icon} Suivi des performances : ${status === "technique" ? "problème technique" : status === "seuil" ? "seuil dépassé" : "seuils respectés"}\n`);
console.log(`**${reason}**\n`);
console.log("| Contexte | |\n| --- | --- |");
console.log(`| Déclenchement | \`${result.event}\` |`);
console.log(`| Révision | \`${result.revision}\` |`);
console.log(`| Route | \`${result.route}\` |`);
console.log(`| Charge | ${result.scenario.vus} utilisateurs virtuels pendant ${result.scenario.duration} |`);
console.log(`| Environnement | ${result.environment} |`);
if (m) {
  console.log("\n| Mesure | Valeur |\n| --- | --- |");
  console.log(`| Requêtes | ${m.requests} (${m.rate_per_s} req/s) |`);
  console.log(`| p95 | ${m.p95_ms} ms |`);
  console.log(`| Erreurs HTTP | ${m.error_rate_pct} % |`);
  console.log(`| Checks réussis | ${m.checks_pct} % |`);
}
if (thresholds.length) {
  console.log("\n| Seuil attendu | Résultat |\n| --- | --- |");
  for (const t of thresholds) console.log(`| ${t.label} : \`${t.threshold}\` | ${t.crossed ? "❌ dépassé" : "✅ respecté"} |`);
}
