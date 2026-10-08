// Construit le tableau Markdown du test de rupture à partir des exports JSON de k6.
// Usage : node scripts/breakpoint-report.mjs <dossier des rapports> <route>...
import { readFileSync } from "node:fs";

const [dir, ...routes] = process.argv.slice(2);
const LABELS = { racine: "GET /", detail: "GET /movies/:id", liste: "GET /movies" };
const THRESHOLD_LABELS = {
  http_req_duration: "temps de réponse (p95 ≥ 500 ms)",
  http_req_failed: "erreurs (≥ 1 %)",
  dropped_iterations: "requêtes abandonnées (API saturée)",
};
const fmt = (n) => Math.round(n).toLocaleString("fr-FR");

const rows = routes.map((route) => {
  const m = JSON.parse(readFileSync(`${dir}/breakpoint-${route}.json`, "utf8")).metrics;
  // Dans l'export k6, un seuil à true est un seuil dépassé.
  const broken = Object.entries(THRESHOLD_LABELS)
    .filter(([metric]) => Object.values(m[metric]?.thresholds ?? {}).includes(true))
    .map(([, label]) => label);
  const reached = m.debit_vise?.value ?? 0;
  return [
    LABELS[route] ?? route,
    broken.length ? `**~${fmt(reached)} req/s**` : `> ${fmt(reached)} req/s (pas de rupture)`,
    `${fmt(m.http_reqs.rate)} req/s`,
    `${fmt(m.http_req_duration["p(95)"])} ms`,
    `${((m.http_req_failed?.value ?? 0) * 100).toFixed(2)} %`,
    broken.join(", ") || "—",
  ];
});

console.log("### Test de rupture : débit à partir duquel chaque route ne tient plus\n");
console.log("| Route | Rupture vers | Débit moyen obtenu | p95 | Erreurs | Seuil cassé |");
console.log("| --- | --- | --- | --- | --- | --- |");
for (const row of rows) console.log(`| ${row.join(" | ")} |`);
console.log("\nLe débit augmente en continu ; « Rupture vers » est le débit demandé au moment où un seuil a cassé.");
