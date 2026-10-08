// Débit maximal : 50 utilisateurs virtuels qui enchaînent les requêtes SANS pause, une route après l'autre.
// Lancement : npm run load:max
import http from "k6/http";
import { check } from "k6";
import type { Options } from "k6/options";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const VUS = 50;
// Durée de chaque scénario en secondes (20 par défaut, 10 dans la CI des push pour aller vite).
const SECONDS = Number(__ENV.SECONDS || 20);
const DURATION = `${SECONDS}s`;
const GAP = 5; // pause entre deux scénarios

// Débit minimal attendu par route (req/s) : le seuil en nombre de requêtes suit la durée choisie.
const MIN_RATE = { racine: 2000, detail: 1000, liste: 200 };
const minCount = (route: keyof typeof MIN_RATE) => [`count>${MIN_RATE[route] * SECONDS}`];

const scenario = (exec: string, index: number) => ({
  executor: "constant-vus" as const,
  vus: VUS,
  duration: DURATION,
  exec,
  startTime: `${index * (SECONDS + GAP)}s`,
  gracefulStop: "2s",
});

export const options: Options = {
  // Les trois scénarios s'exécutent à la suite (startTime), avec 5 s de pause entre eux ;
  // gracefulStop court pour qu'un scénario soit bien fini avant le suivant.
  scenarios: {
    racine: scenario("racine", 0),
    liste: scenario("liste", 1),
    detail: scenario("detail", 2),
  },
  // Seuils anti-régression, calibrés sur la CI (base jetable) avec une marge :
  // au moins ~50 % du débit mesuré, et un p95 au plus ~3 fois celui mesuré.
  //   mesuré en CI → racine 4 400 req/s, p95 15 ms | detail 2 070 req/s, p95 33 ms | liste 406 req/s, p95 202 ms
  // En local sur Atlas (bridé), detail et liste ne les tiennent pas : c'est attendu.
  thresholds: {
    "http_reqs{scenario:racine}": minCount("racine"),
    "http_reqs{scenario:detail}": minCount("detail"),
    "http_reqs{scenario:liste}": minCount("liste"),
    "http_req_duration{scenario:racine}": ["p(95)<100"],
    "http_req_duration{scenario:detail}": ["p(95)<150"],
    "http_req_duration{scenario:liste}": ["p(95)<600"],
    "http_req_failed{scenario:racine}": ["rate<0.01"],
    "http_req_failed{scenario:detail}": ["rate<0.01"],
    "http_req_failed{scenario:liste}": ["rate<0.01"],
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
