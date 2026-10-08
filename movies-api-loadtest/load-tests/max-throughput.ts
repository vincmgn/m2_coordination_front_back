// Débit maximal : 50 utilisateurs virtuels qui enchaînent les requêtes SANS pause, une route après l'autre.
// Lancement : npm run load:max
import http from "k6/http";
import { check } from "k6";
import type { Options } from "k6/options";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const VUS = 50;
const DURATION = "20s";

export const options: Options = {
  // Les trois scénarios s'exécutent à la suite (startTime), avec 5 s de pause entre eux ;
  // gracefulStop court pour qu'un scénario soit bien fini avant le suivant.
  scenarios: {
    racine: { executor: "constant-vus", vus: VUS, duration: DURATION, exec: "racine", startTime: "0s", gracefulStop: "2s" },
    liste: { executor: "constant-vus", vus: VUS, duration: DURATION, exec: "liste", startTime: "25s", gracefulStop: "2s" },
    detail: { executor: "constant-vus", vus: VUS, duration: DURATION, exec: "detail", startTime: "50s", gracefulStop: "2s" },
  },
  // Sans seuil : sert juste à afficher le détail par route dans le résumé.
  thresholds: {
    "http_reqs{scenario:racine}": [],
    "http_reqs{scenario:liste}": [],
    "http_reqs{scenario:detail}": [],
    "http_req_duration{scenario:racine}": [],
    "http_req_duration{scenario:liste}": [],
    "http_req_duration{scenario:detail}": [],
    "http_req_failed{scenario:racine}": [],
    "http_req_failed{scenario:liste}": [],
    "http_req_failed{scenario:detail}": [],
  },
};

// Récupère une centaine d'_id réels pour GET /movies/:id.
export function setup(): { ids: string[] } {
  const res = http.get(`${BASE_URL}/movies?limit=100`);
  if (res.status !== 200) throw new Error(`API injoignable sur ${BASE_URL} (status ${res.status})`);
  return { ids: (res.json("data") as { _id: string }[]).map((m) => m._id) };
}

// GET / : aucune requête MongoDB, mesure Express seul.
export function racine() {
  check(http.get(`${BASE_URL}/`), { "/ 200": (r) => r.status === 200 });
}

// GET /movies : 2 requêtes MongoDB (page de 20 films + total).
export function liste() {
  check(http.get(`${BASE_URL}/movies`), { "/movies 200": (r) => r.status === 200 });
}

// GET /movies/:id : 1 requête MongoDB par _id (indexé).
export function detail({ ids }: { ids: string[] }) {
  const id = ids[Math.floor(Math.random() * ids.length)];
  check(http.get(`${BASE_URL}/movies/${id}`), { "/movies/:id 200": (r) => r.status === 200 });
}
