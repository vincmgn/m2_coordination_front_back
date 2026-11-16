// Point d'entrée des traces, chargé avant l'application : node --import ./dist/instrumentation.js dist/index.js
// (l'équivalent de -javaagent pour une JVM). Se configure par les variables OTEL_* (cf. docker-compose.yml).
//
// L'API est en modules ES : le crochet de chargement doit être enregistré AVANT de démarrer le SDK, sinon
// express et mongodb, chargés par import, ne sont jamais instrumentés (seul http, module natif, le serait).
import { register } from "node:module";

register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);
await import("@opentelemetry/auto-instrumentations-node/register");
