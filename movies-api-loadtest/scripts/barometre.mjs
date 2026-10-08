// Baromètre W/L : historique Win/Loss des derniers runs d'un workflow, lu via l'API GitHub Actions.
// Le run en cours n'est pas encore terminé : son résultat est passé en variable (CURRENT_CONCLUSION).
// Usage : GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo WORKFLOW_FILE=perf-suivi.yml \
//         CURRENT_CONCLUSION=success|failure CURRENT_TITLE="…" node scripts/barometre.mjs
const API = process.env.GITHUB_API_URL || "https://api.github.com";
const {
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  GITHUB_RUN_ID,
  GITHUB_EVENT_NAME,
  WORKFLOW_FILE,
  CURRENT_CONCLUSION,
  CURRENT_TITLE,
  GITHUB_SERVER_URL = "https://github.com",
} = process.env;
const SIZE = Number(process.env.BAROMETRE_SIZE || 20);

const ICONS = { success: "✅", failure: "❌" };
const isCounted = (c) => c === "success" || c === "failure"; // annulés / ignorés : ni W ni L

async function fetchRuns() {
  const res = await fetch(
    `${API}/repos/${GITHUB_REPOSITORY}/actions/workflows/${WORKFLOW_FILE}/runs?status=completed&per_page=${SIZE}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(GITHUB_TOKEN && { Authorization: `Bearer ${GITHUB_TOKEN}` }),
      },
    },
  );
  if (!res.ok) throw new Error(`API GitHub : HTTP ${res.status} ${await res.text()}`);
  return (await res.json()).workflow_runs;
}

function weather(ratio) {
  if (ratio >= 0.8) return "☀️ Beau fixe";
  if (ratio >= 0.5) return "⛅ Variable";
  return "🌧️ Tempête";
}

try {
  // Plus récent en premier ; le run en cours (pas encore « completed ») est ajouté en tête.
  const runs = (await fetchRuns())
    .filter((r) => String(r.id) !== GITHUB_RUN_ID)
    .map((r) => ({
      conclusion: r.conclusion,
      title: r.display_title,
      event: r.event,
      date: r.run_started_at ?? r.created_at,
      url: r.html_url,
    }));
  if (CURRENT_CONCLUSION) {
    runs.unshift({
      conclusion: CURRENT_CONCLUSION,
      title: `${(CURRENT_TITLE || "run en cours").split("\n")[0]} (ce run)`,
      event: GITHUB_EVENT_NAME,
      date: new Date().toISOString(),
      url: `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`,
    });
  }
  const recent = runs.slice(0, SIZE);
  const counted = recent.filter((r) => isCounted(r.conclusion));
  const wins = counted.filter((r) => r.conclusion === "success").length;
  const losses = counted.length - wins;

  console.log(`### Baromètre W/L : ${WORKFLOW_FILE}\n`);
  if (!counted.length) {
    console.log("Pas encore assez de runs terminés pour établir un baromètre.");
  } else {
    const ratio = wins / counted.length;
    // Série en cours : nombre de runs consécutifs avec le même résultat que le plus récent.
    const streakIndex = counted.findIndex((r) => r.conclusion !== counted[0].conclusion);
    const streak = streakIndex === -1 ? counted.length : streakIndex;
    const timeline = [...recent].reverse().map((r) => ICONS[r.conclusion] ?? "⚪").join("");

    console.log(`**${weather(ratio)}** : **${wins} W / ${losses} L** sur les ${counted.length} derniers runs (${Math.round(ratio * 100)} % de réussite)\n`);
    console.log(`Série en cours : ${streak} ${counted[0].conclusion === "success" ? "W" : "L"} d'affilée\n`);
    console.log(`Du plus ancien au plus récent : ${timeline}  (⚪ = annulé ou ignoré, non compté)\n`);
    console.log("| Date | Déclenchement | Run | Résultat |\n| --- | --- | --- | --- |");
    for (const r of recent.slice(0, 10)) {
      const date = new Date(r.date).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });
      console.log(`| ${date} | \`${r.event}\` | [${r.title.replaceAll("|", "\\|")}](${r.url}) | ${ICONS[r.conclusion] ?? `⚪ ${r.conclusion}`} |`);
    }
  }
} catch (e) {
  // Le baromètre est informatif : son échec ne doit pas masquer le résultat du test.
  console.log(`Baromètre indisponible : ${e.message}`);
  console.error(`::warning::Baromètre W/L indisponible : ${e.message}`);
}
