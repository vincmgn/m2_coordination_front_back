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
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
    checks: ["rate==1"],
  },
};

export function setup() {
  const res = http.get(`${BASE_URL}/movies?limit=1`);
  if (res.status !== 200) throw new Error(`API injoignable sur ${BASE_URL} (status ${res.status}) : test impossible`);
  if (!(Number(res.json("total")) > 0)) throw new Error("Jeu de données vide : aucune mesure exploitable");
}

export default function () {
  const page = 1 + Math.floor(Math.random() * 50);
  const res = http.get(`${BASE_URL}/movies?page=${page}&limit=20`, { tags: { name: "GET /movies" } });
  check(res, {
    "status 200": (r) => r.status === 200,
    "20 films renvoyés": (r) => {
      try {
        return (r.json("data") as unknown[] | undefined)?.length === 20;
      } catch {
        return false;
      }
    },
  });
  sleep(1);
}
