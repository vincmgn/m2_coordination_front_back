import http from "k6/http";
import { check } from "k6";
import exec from "k6/execution";
import { Gauge } from "k6/metrics";
import type { Options } from "k6/options";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const DURATION = __ENV.DURATION || "60s";
const START_RATE = 10;

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
      executor: "ramping-arrival-rate",
      startRate: START_RATE,
      timeUnit: "1s",
      stages: [{ duration: DURATION, target: ROUTES[ROUTE].max }],
      preAllocatedVUs: 50,
      maxVUs: 1000,
    },
  },
  thresholds: {
    http_req_duration: [{ threshold: "p(95)<500", abortOnFail: true, delayAbortEval: "5s" }],
    http_req_failed: [{ threshold: "rate<0.01", abortOnFail: true, delayAbortEval: "5s" }],
    dropped_iterations: [{ threshold: "count<50", abortOnFail: true }],
  },
};

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
