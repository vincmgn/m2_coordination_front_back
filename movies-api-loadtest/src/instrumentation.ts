import { register } from "node:module";

register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);
await import("@opentelemetry/auto-instrumentations-node/register");
