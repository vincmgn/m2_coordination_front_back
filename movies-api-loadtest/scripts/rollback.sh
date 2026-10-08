#!/usr/bin/env bash
# Rollback manuel : remet en service une version déjà construite de l'API (par défaut la précédente).
# Seul le conteneur api change : la base et ses données ne sont pas touchées.
# Usage : scripts/rollback.sh [version]
set -uo pipefail
cd "$(dirname "$0")/.."
source scripts/deploy-lib.sh

CURRENT=$(current_version)
TARGET=${1:-$(previous_version)}
[ -n "$TARGET" ] || { echo "Aucune version précédente connue : précisez-la (scripts/rollback.sh <version>)."; exit 1; }
docker image inspect "movies-api:$TARGET" > /dev/null 2>&1 || { echo "Image movies-api:$TARGET introuvable."; exit 1; }

step "Rollback ${CURRENT:-?} → $TARGET (données conservées)"
before=$(movie_count 2>/dev/null || echo "?")
switch_api "$TARGET" || { echo "❌ Rollback impossible"; exit 1; }
set_versions "$TARGET" "$CURRENT"
log_history "rollback ${CURRENT:-?} → $TARGET"
echo "✅ $TARGET en service. Films en base : avant $before, après $(movie_count)."
