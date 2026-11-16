// La position du spectateur sert à la requête, puis on l'oublie : ni journal (API, nginx), ni stockage, ni trace.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
// Variables nginx qui contiennent la chaîne de requête (?lat=…&lon=…). $request_method et $request_time sont sans danger.
const QUERY_STRING = /\$(request(?![_a-z])|request_uri|args|query_string|arg_\w+|is_args)/;

describe("Vie privée de la position", () => {
  it("le code geo et la route /cinemas ne journalisent rien", () => {
    const files = [
      ...readdirSync(new URL("../src/geo/", import.meta.url)).map((f) => `../src/geo/${f}`),
      "../src/routes/cinemas.ts",
    ];
    for (const f of files) assert.doesNotMatch(read(f), /\bconsole\.(log|info|warn|error|debug|trace)\(|\blogger\./i, `${f} ne doit rien journaliser`);
  });

  it("nginx journalise sans la chaîne de requête, sur tout le serveur et dans location /api/", () => {
    const conf = read("../../movies-web/nginx.conf").replace(/#.*$/gm, "");
    const formats = [...conf.matchAll(/log_format\s+(\w+)([^;]*);/g)];
    assert.ok(formats.length > 0, "sans log_format, nginx utilise « main », qui contient $request");
    for (const [, name, body] of formats) assert.doesNotMatch(body, QUERY_STRING, `le format ${name} journalise la requête`);
    const safe = formats.map(([, name]) => name);
    const logs = [...conf.matchAll(/access_log\s+(\S+)(?:\s+(\w+))?/g)];
    assert.ok(logs.length > 0, "aucun access_log : le format par défaut du conteneur s'appliquerait");
    for (const [line, target, format] of logs) if (target !== "off") assert.ok(format && safe.includes(format), line);
    const api = /location\s+\/api\/\s*\{([^}]*)\}/.exec(conf);
    assert.ok(api?.[1].includes("access_log"), "location /api/ doit déclarer son access_log sans requête");
  });

  it("les traces perdent la chaîne de requête : navigateur (url.full) et collecteur (url.query)", () => {
    assert.match(read("../../movies-web/src/tracing.ts"), /StripQueryProcessor/);
    assert.match(read("../observabilite/collector.yaml"), /key: url\.query, action: delete/);
    // Instrumentation MongoDB : les valeurs des requêtes sont remplacées par « ? » tant que ce réglage n'est pas activé.
    assert.doesNotMatch(read("../docker-compose.yml"), /enhancedDatabaseReporting|OTEL_INSTRUMENTATION_MONGODB_ENHANCED/i);
  });

  it("seuls les cinémas ont une position en base", () => {
    const writes = readdirSync(new URL("../src/", import.meta.url), { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".ts") && /\b(latitude|longitude|coordinates)\b/.test(read(`../src/${f}`)));
    assert.deepEqual(writes.sort(), ["geo/cinemas-seed.ts", "geo/distance.ts", "geo/finders.ts", "routes/cinemas.ts"].sort());
  });
});
