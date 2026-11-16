#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."
REPORTS=load-tests/reports
PALIERS=${PALIERS:-"5 10 20 50 100 200 400 800 1600"}
mkdir -p "$REPORTS"
rm -f "$REPORTS"/palier-*.json "$REPORTS"/palier-*.txt

done_paliers=()
for vus in $PALIERS; do
  echo "Palier $vus utilisateurs virtuels ..." >&2
  scripts/k6.sh run --quiet -e "VUS=$vus" --summary-export "$REPORTS/palier-$vus.json" "$@" \
    load-tests/paliers.ts > "$REPORTS/palier-$vus.txt" 2>&1
  code=$?
  done_paliers+=("$vus")
  if [[ $code -eq 99 ]]; then
    break
  elif [[ $code -ne 0 ]]; then
    echo "Erreur technique au palier $vus (code k6 $code) :" >&2
    tail -20 "$REPORTS/palier-$vus.txt" >&2
    exit "$code"
  fi
done

node scripts/paliers-report.mjs "$REPORTS" "${done_paliers[@]}" | tee "$REPORTS/paliers.md"
