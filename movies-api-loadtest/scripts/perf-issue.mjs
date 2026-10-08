// Suivi des incidents de performance dans GitHub Issues, à partir du résultat interprété (perf-result.mjs).
//   seuil dépassé       → crée un ticket, ou commente le ticket ouvert du même problème (nouvelle occurrence)
//   seuils respectés    → commente le ticket ouvert s'il existe (retour sous les seuils) ; ne ferme JAMAIS
//   problème technique  → aucune publication : les mesures ne permettent pas de conclure
// Usage : RESULT_JSON='{…}' GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo node scripts/perf-issue.mjs
// Codes de sortie : 0 = publication faite ou inutile, 1 = résultat inexploitable, 2 = appel GitHub refusé.

import { appendFileSync } from "node:fs";

const LABEL = "performance";
const API = process.env.GITHUB_API_URL || "https://api.github.com";
const { GITHUB_TOKEN, GITHUB_REPOSITORY, RESULT_JSON, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT } = process.env;

class GitHubError extends Error {}

// Affiche le message dans le journal ET dans le résumé du run (bloc « publish summary »), avec le lien du ticket.
function outcome(message, { error = false } = {}) {
  console[error ? "error" : "log"](error ? `::error::${message}` : message);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ${error ? "⚠️" : "🎫"} Suivi GitHub Issues\n\n${message}\n`);
  }
}
const link = (i) => `[ticket #${i.number}](${i.html_url})`;

async function github(method, path, body) {
  // Nouvelle tentative uniquement pour les erreurs passagères (limite de débit, panne côté GitHub).
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body && { "Content-Type": "application/json" }),
      },
      body: body && JSON.stringify(body),
    });
    if (res.ok) return res.status === 204 ? null : res.json();
    const transient = res.status === 429 || res.status >= 500;
    if (transient && attempt < 3) {
      console.log(`GitHub ${method} ${path} → ${res.status}, nouvelle tentative dans ${attempt * 5} s`);
      await new Promise((r) => setTimeout(r, attempt * 5000));
      continue;
    }
    const detail = await res.text().catch(() => "");
    throw new GitHubError(`GitHub a refusé ${method} ${path} (HTTP ${res.status}) : ${detail.slice(0, 300)}`);
  }
}

// Récupère toutes les pages d'une liste (100 éléments par page).
async function githubList(path) {
  const items = [];
  for (let page = 1; ; page++) {
    const batch = await github("GET", `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

function parseResult() {
  try {
    const result = JSON.parse(RESULT_JSON ?? "");
    if (!["ok", "seuil", "technique"].includes(result.status)) throw new Error(`statut inconnu « ${result.status} »`);
    return result;
  } catch (e) {
    outcome(`Résultat du test inexploitable, aucune publication : ${e.message}`, { error: true });
    process.exit(1);
  }
}

const table = (rows) => ["| | |", "| --- | --- |", ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join("\n");

function report(r) {
  const m = r.measures;
  const [owner, repo] = GITHUB_REPOSITORY.split("/");
  const lines = [
    table([
      ["Route testée", `\`${r.route}\``],
      ["Scénario de charge", `\`${r.scenario.script}\` : ${r.scenario.vus} utilisateurs virtuels pendant ${r.scenario.duration}`],
      ["Révision", `[\`${r.revision.slice(0, 7)}\`](https://github.com/${owner}/${repo}/commit/${r.revision})`],
      ["Environnement", r.environment],
      ["Déclenchement", `\`${r.event}\` le ${new Date(r.date).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}`],
      ["Exécution et rapports", `[run ${GITHUB_RUN_ID}](${r.run_url}) (rapports dans la section *Artifacts*)`],
    ]),
    "",
    "| Mesure observée | Valeur |",
    "| --- | --- |",
    `| p95 | ${m.p95_ms} ms |`,
    `| Erreurs HTTP | ${m.error_rate_pct} % |`,
    `| Checks réussis | ${m.checks_pct} % |`,
    `| Requêtes | ${m.requests} (${m.rate_per_s} req/s) |`,
    "",
    "| Seuil attendu | Résultat |",
    "| --- | --- |",
    ...r.thresholds.map((t) => `| ${t.label} : \`${t.threshold}\` | ${t.crossed ? "❌ dépassé" : "✅ respecté"} |`),
  ];
  return lines.join("\n");
}

async function ensureLabel(repoPath) {
  try {
    await github("GET", `${repoPath}/labels/${LABEL}`);
  } catch (e) {
    if (!(e instanceof GitHubError) || !e.message.includes("HTTP 404")) throw e;
    await github("POST", `${repoPath}/labels`, {
      name: LABEL,
      color: "d93f0b",
      description: "Seuil de performance dépassé (suivi automatique k6)",
    });
  }
}

async function main() {
  const r = parseResult();
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
    outcome("GITHUB_TOKEN ou GITHUB_REPOSITORY absent : publication impossible.", { error: true });
    process.exit(2);
  }

  if (r.status === "technique") {
    outcome(`Problème technique (${r.reason}) : aucune publication, les mesures ne permettent pas de conclure.`);
    return;
  }

  const repoPath = `/repos/${GITHUB_REPOSITORY}`;
  // Empreinte stable du problème : même route + même scénario = même ticket, quelle que soit la charge.
  const fingerprint = `<!-- perf-fingerprint: ${r.route} | ${r.scenario.script} -->`;
  // Marqueur du run : relancer le même run ne publie pas deux fois.
  const runMarker = `<!-- perf-run: ${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT ?? 1} -->`;

  // Liste (et non recherche, indexée avec retard) des tickets ouverts du label, puis filtre sur l'empreinte.
  const openIssues = await githubList(`${repoPath}/issues?state=open&labels=${LABEL}`);
  const issue = openIssues.find((i) => !i.pull_request && i.body?.includes(fingerprint));

  if (issue) {
    const comments = await githubList(`${repoPath}/issues/${issue.number}/comments`);
    if (issue.body.includes(runMarker) || comments.some((c) => c.body?.includes(runMarker))) {
      outcome(`Run déjà publié sur le ${link(issue)} : rien à faire.`);
      return;
    }
  }

  if (r.status === "seuil") {
    if (issue) {
      await github("POST", `${repoPath}/issues/${issue.number}/comments`, {
        body: `${runMarker}\n### ❌ Nouvelle occurrence : seuil toujours dépassé\n\n${report(r)}`,
      });
      outcome(`❌ Nouvelle occurrence ajoutée au ${link(issue)} (pas de nouveau ticket : même problème).`);
    } else {
      await ensureLabel(repoPath);
      const created = await github("POST", `${repoPath}/issues`, {
        title: `[Perf] Seuil dépassé : ${r.route}`,
        labels: [LABEL],
        body: [
          fingerprint,
          runMarker,
          "Le test de charge k6 ne respecte plus les seuils de performance.",
          "",
          report(r),
          "",
          "---",
          "Les prochaines occurrences et le retour sous les seuils seront ajoutés en commentaire de ce ticket.",
          "**Ce ticket n'est jamais fermé automatiquement** : à fermer par une personne après analyse.",
        ].join("\n"),
      });
      outcome(`❌ Nouveau problème de seuil : ${link(created)} créé.`);
    }
  } else if (issue) {
    await github("POST", `${repoPath}/issues/${issue.number}/comments`, {
      body: [
        runMarker,
        "### ✅ Retour sous les seuils",
        "",
        report(r),
        "",
        "Le ticket reste ouvert : à fermer par une personne après analyse.",
      ].join("\n"),
    });
    outcome(`✅ Retour sous les seuils ajouté au ${link(issue)} (le ticket reste ouvert : à fermer après analyse).`);
  } else {
    outcome("✅ Seuils respectés et aucun ticket ouvert : rien à publier.");
  }
}

main().catch((e) => {
  outcome(e instanceof GitHubError ? e.message : `Publication impossible : ${e.message}`, { error: true });
  process.exit(2);
});
