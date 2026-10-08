// Test de montée en charge, lecture seule (aucune écriture sur la base Atlas).
// Lancement : npm run load  (BASE_URL modifiable : npm run load -- -e BASE_URL=http://...)
import http from "k6/http";
import { check, sleep } from "k6";
import type { Options } from "k6/options";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

export const options: Options = {
  stages: [
    { duration: "20s", target: 10 },
    { duration: "30s", target: 30 },
    { duration: "30s", target: 50 },
    { duration: "20s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800"],
    // Sans seuil : sert juste à afficher le détail par type de requête dans le résumé.
    "http_req_duration{name:liste}": [],
    "http_req_duration{name:titre}": [],
    "http_req_duration{name:genre+année}": [],
    "http_req_duration{name:détail}": [],
  },
};

const TITLES = ["star", "love", "night", "man", "war"];
const GENRES = ["Drama", "Comedy", "Action", "Western", "Horror"];

// Récupère une centaine d'_id réels pour les requêtes GET /movies/:id.
export function setup(): { ids: string[] } {
  const res = http.get(`${BASE_URL}/movies?limit=100`);
  if (res.status !== 200) throw new Error(`API injoignable sur ${BASE_URL} (status ${res.status})`);
  return { ids: (res.json("data") as { _id: string }[]).map((m) => m._id) };
}

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

export default function ({ ids }: { ids: string[] }) {
  const page = 1 + Math.floor(Math.random() * 50);
  const requests: [string, string][] = [
    ["liste", `${BASE_URL}/movies?page=${page}&limit=20`],
    ["titre", `${BASE_URL}/movies?title=${pick(TITLES)}`],
    ["genre+année", `${BASE_URL}/movies?genre=${pick(GENRES)}&year=${1950 + Math.floor(Math.random() * 60)}`],
    ["détail", `${BASE_URL}/movies/${pick(ids)}`],
  ];

  for (const [name, url] of requests) {
    const res = http.get(url, { tags: { name } });
    check(res, { [`${name} 200`]: (r) => r.status === 200 });
  }
  sleep(1);
}
