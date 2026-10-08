// Construit le tableau Markdown du test par paliers à partir des exports JSON de k6.
// Usage : node scripts/paliers-report.mjs <dossier des rapports> <vus>...
import { readFileSync } from "node:fs";

const [dir, ...paliers] = process.argv.slice(2);
const fmt = (n, digits = 0) => n.toLocaleString("fr-FR", { maximumFractionDigits: digits });

// Dans l'export k6, un seuil à true est un seuil dépassé.
const brokenThresholds = (metric) =>
  Object.entries(metric?.thresholds ?? {})
    .filter(([, crossed]) => crossed)
    .map(([threshold]) => threshold);

let firstFailure;
const rows = paliers.map((vus) => {
  const m = JSON.parse(readFileSync(`${dir}/palier-${vus}.json`, "utf8")).metrics;
  const broken = [
    ...brokenThresholds(m.http_req_duration).map((t) => `temps de réponse (${t})`),
    ...brokenThresholds(m.http_req_failed).map((t) => `erreurs (${t})`),
    ...brokenThresholds(m.checks).map((t) => `checks (${t})`),
  ];
  if (broken.length && !firstFailure) firstFailure = vus;
  return [
    vus,
    `${fmt(m.http_reqs.rate)} req/s`,
    `${fmt(m.http_req_duration["p(95)"])} ms`,
    `${fmt((m.http_req_failed?.value ?? 0) * 100, 2)} %`,
    `${fmt((m.checks?.value ?? 0) * 100, 2)} %`,
    broken.length ? `❌ ${broken.join(", ")}` : "✅ passe",
  ];
});

console.log("### Test par paliers : GET /movies (p95 < 500 ms, erreurs < 1 %, checks 100 %)\n");
console.log("| Utilisateurs virtuels | Débit | p95 | Erreurs | Checks réussis | Résultat |");
console.log("| --- | --- | --- | --- | --- | --- |");
for (const row of rows) console.log(`| ${row.join(" | ")} |`);
console.log(
  firstFailure
    ? `\n**Premier dépassement à ${firstFailure} utilisateurs virtuels** : la montée en charge s'est arrêtée là.`
    : `\nAucun dépassement jusqu'à ${paliers.at(-1)} utilisateurs virtuels (dernier palier prévu).`,
);
