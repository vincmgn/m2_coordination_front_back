#!/usr/bin/env bash
set -uo pipefail

WEB=${WEB_URL:-http://localhost:8081}
JAEGER=${JAEGER_URL:-http://localhost:16686}
ok=0
ko=0
result() {
  if [ "$1" -eq 0 ]; then echo "OK     $2"; ok=$((ok + 1)); else echo "ÉCHEC  $2 — $3"; ko=$((ko + 1)); fi
}

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"resourceSpans":[]}' "$WEB/otlp/v1/traces")
[ "$code" = 200 ]; result $? "1. nginx relaie POST /otlp/v1/traces au collecteur" "HTTP $code (location /otlp/ absente de nginx.conf ?)"

curl -s -o /dev/null "$WEB/api/movies/genres"
found=1
for _ in $(seq 1 15); do
  if curl -s "$JAEGER/api/v3/services" | grep -q '"movies-api"'; then found=0; break; fi
  sleep 1
done
result $found "2. Jaeger propose le service movies-api" "absent après 15 s (instrumentation chargée ? exportateur dans le pipeline ?)"

trace_id=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
span_id=$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')
curl -s -o /dev/null -H "traceparent: 00-$trace_id-$span_id-01" "$WEB/api/movies/genres"
found=1
for _ in $(seq 1 15); do
  if curl -s "$JAEGER/api/v3/traces/$trace_id" | node -e '
    const [spanId] = process.argv.slice(1);
    const hex = (id) => (/^[0-9a-f]+$/i.test(id ?? "") ? id.toLowerCase() : Buffer.from(id ?? "", "base64").toString("hex"));
    const body = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const child = (body.result?.resourceSpans ?? [])
      .filter((rs) => rs.resource?.attributes?.some((a) => a.key === "service.name" && a.value?.stringValue === "movies-api"))
      .flatMap((rs) => rs.scopeSpans.flatMap((ss) => ss.spans))
      .find((s) => hex(s.parentSpanId) === spanId);
    process.exit(child ? 0 : 1);
' "$span_id" 2>/dev/null; then found=0; break; fi
  sleep 1
done
result $found "3. l'API reprend le traceparent (trace $trace_id)" "aucun span movies-api enfant de $span_id"

echo
echo "Bilan : $ok OK, $ko ÉCHEC"
[ "$ko" -eq 0 ]
