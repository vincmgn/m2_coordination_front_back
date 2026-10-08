// Test par paliers : UN palier = un lancement de k6 avec un nombre fixe d'utilisateurs virtuels (VUS).
// Même scénario et mêmes seuils à chaque palier, pour comparer les essais (étape 5 du TP).
// Lancement d'un palier : scripts/k6.sh run -e VUS=20 load-tests/paliers.ts
// Tous les paliers : npm run load:paliers (voir scripts/paliers.sh)
import http from "k6/http";
import { check, sleep } from "k6";
import type { Options } from "k6/options";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const VUS = Number(__ENV.VUS || 5);
const DURATION = __ENV.DURATION || "30s";

export const options: Options = {
  scenarios: {
    palier: { executor: "constant-vus", vus: VUS, duration: DURATION },
  },
  // Seuils du TP (objectifs pédagogiques) : un seul dépassement suffit pour que le palier échoue.
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
    checks: ["rate==1"],
  },
};

// Vérification avant la charge : API joignable et jeu de données non vide. Sinon k6 s'arrête en erreur
// de script (code ≠ 99), ce qui distingue un problème technique d'un seuil dépassé.
export function setup() {
  const res = http.get(`${BASE_URL}/movies?limit=1`);
  if (res.status !== 200) throw new Error(`API injoignable sur ${BASE_URL} (status ${res.status}) : test impossible`);
  if (!(Number(res.json("total")) > 0)) throw new Error("Jeu de données vide : aucune mesure exploitable");
}

// Lecture mesurée : une page de la liste des films (page au hasard parmi les 50 premières).
export default function () {
  const page = 1 + Math.floor(Math.random() * 50);
  const res = http.get(`${BASE_URL}/movies?page=${page}&limit=20`, { tags: { name: "GET /movies" } });
  check(res, {
    "status 200": (r) => r.status === 200,
    "20 films renvoyés": (r) => {
      try {
        return (r.json("data") as unknown[] | undefined)?.length === 20;
      } catch {
        return false; // corps non JSON (erreur, page HTML…) : le check échoue au lieu de planter l'itération
      }
    },
  });
  // Temps de réflexion d'un utilisateur réel entre deux pages.
  sleep(1);
}
