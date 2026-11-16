#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."
REPORTS=load-tests/reports
mkdir -p "$REPORTS"

for route in ${ROUTES:-racine detail liste}; do
  echo "Test de rupture : $route ..." >&2
  scripts/k6.sh run --quiet -e "ROUTE=$route" --summary-export "$REPORTS/breakpoint-$route.json" "$@" \
    load-tests/breakpoint.ts > "$REPORTS/breakpoint-$route.txt" 2>&1
  code=$?
  if [[ $code -ne 0 && $code -ne 99 ]]; then
    cat "$REPORTS/breakpoint-$route.txt" >&2
    exit "$code"
  fi
done

node scripts/breakpoint-report.mjs "$REPORTS" ${ROUTES:-racine detail liste} | tee "$REPORTS/breakpoint.md"
