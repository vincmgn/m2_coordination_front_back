#!/usr/bin/env bash
# Lance load-tests/paliers.ts palier par palier (charge croissante) et s'arrête au premier palier qui échoue.
# Tableau récapitulatif affiché et enregistré dans load-tests/reports/paliers.md.
# Variables : PALIERS="5 10 20" (utilisateurs virtuels), DURATION=30s ; arguments supplémentaires passés à k6.
# Codes de sortie : 0 = tableau produit (dépassement trouvé ou non), autre = problème technique.
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
  # 0 = seuils respectés, 99 = seuil dépassé ; tout le reste (API injoignable, script cassé…) est technique.
  if [[ $code -eq 99 ]]; then
    break
  elif [[ $code -ne 0 ]]; then
    echo "Erreur technique au palier $vus (code k6 $code) :" >&2
    tail -20 "$REPORTS/palier-$vus.txt" >&2
    exit "$code"
  fi
done

node scripts/paliers-report.mjs "$REPORTS" "${done_paliers[@]}" | tee "$REPORTS/paliers.md"
