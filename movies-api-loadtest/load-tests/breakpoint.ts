// Test de rupture (breakpoint) : le débit demandé augmente en continu sur UNE route,
// jusqu'à ce qu'un seuil casse (k6 s'arrête alors) ou que le débit maximal prévu soit atteint.
// Lancement : npm run load:breakpoint (enchaîne les 3 routes, voir scripts/breakpoint.sh)
import http from "k6/http";
import { check } from "k6";
import exec from "k6/execution";
import { Gauge } from "k6/metrics";
import type { Options } from "k6/options";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const DURATION = __ENV.DURATION || "60s";
const START_RATE = 10;

// Débit maximal visé par route (req/s), au-delà de ce qu'on a mesuré en CI pour être sûr de casser.
const ROUTES = {
  racine: { max: 12000, url: () => `${BASE_URL}/` },
  detail: { max: 4000, url: (ids: string[]) => `${BASE_URL}/movies/${ids[Math.floor(Math.random() * ids.length)]}` },
  liste: { max: 1500, url: () => `${BASE_URL}/movies` },
};
type Route = keyof typeof ROUTES;

const ROUTE = (__ENV.ROUTE || "racine") as Route;
if (!(ROUTE in ROUTES)) throw new Error(`ROUTE inconnue : ${ROUTE} (attendu : ${Object.keys(ROUTES).join(", ")})`);

export const options: Options = {
  scenarios: {
    rupture: {
      // Modèle « ouvert » : k6 envoie N requêtes/s quoi qu'il arrive, même si l'API ralentit.
      executor: "ramping-arrival-rate",
      startRate: START_RATE,
      timeUnit: "1s",
      stages: [{ duration: DURATION, target: ROUTES[ROUTE].max }],
      preAllocatedVUs: 50,
      maxVUs: 1000,
    },
  },
  // Les seuils qui définissent « ça ne passe plus ». abortOnFail arrête le test dès qu'ils cassent.
  // delayAbortEval laisse 5 s au démarrage pour que les premières mesures ne déclenchent pas l'arrêt.
  thresholds: {
    http_req_duration: [{ threshold: "p(95)<500", abortOnFail: true, delayAbortEval: "5s" }],
    http_req_failed: [{ threshold: "rate<0.01", abortOnFail: true, delayAbortEval: "5s" }],
    // Requêtes que k6 n'a pas pu envoyer faute d'utilisateur virtuel libre : l'API ne suit plus le débit.
    // Réagit plus vite que le p95, calculé depuis le début du test et donc « lissé » par les premières requêtes rapides.
    dropped_iterations: [{ threshold: "count<50", abortOnFail: true }],
  },
};

// Débit visé au moment de chaque requête : sa dernière valeur = débit atteint quand le test s'est arrêté.
const targetRate = new Gauge("debit_vise");

export function setup(): { ids: string[] } {
  const res = http.get(`${BASE_URL}/movies?limit=100`);
  if (res.status !== 200) throw new Error(`API injoignable sur ${BASE_URL} (status ${res.status})`);
  return { ids: (res.json("data") as { _id: string }[]).map((m) => m._id) };
}

export default function ({ ids }: { ids: string[] }) {
  targetRate.add(START_RATE + (ROUTES[ROUTE].max - START_RATE) * exec.scenario.progress);
  const res = http.get(ROUTES[ROUTE].url(ids), { tags: { name: ROUTE } });
  check(res, { "status 200": (r) => r.status === 200 });
}
