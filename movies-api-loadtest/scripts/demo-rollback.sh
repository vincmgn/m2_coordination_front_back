#!/usr/bin/env bash
# Démonstration de bout en bout : une version défectueuse est refusée et l'API revient à la version
# précédente, sans perte de données (y compris les données écrites juste avant le déploiement raté).
set -uo pipefail
cd "$(dirname "$0")/.."
source scripts/deploy-lib.sh

step "Préparation : MongoDB et jeu de données"
docker compose up -d --wait mongo || exit 1
count=$(docker compose exec -T mongo mongosh --quiet sample_mflix --eval 'db.movies.countDocuments()')
if [ "$count" = "0" ]; then
  MONGODB_URI=mongodb://localhost:27018 npm run -s seed || exit 1
else
  echo "Base déjà remplie : $count films (rien n'est effacé)."
fi

step "Étape 1 : déploiement de la v1"
scripts/deploy.sh v1 || exit 1

step "Étape 2 : écriture de données pendant que la v1 est en service"
id=$(curl -sf -X POST -H 'Content-Type: application/json' \
  -d "{\"title\":\"Film créé avant la v2 ($(date +%H:%M:%S))\",\"year\":2026,\"genres\":[\"Drama\"]}" \
  "$API_URL/movies" | node -p 'JSON.parse(require("fs").readFileSync(0))._id')
before=$(movie_count)
echo "Film créé : $id — films en base : $before"

step "Étape 3 : déploiement d'une v2 défectueuse (+800 ms par requête)"
if scripts/deploy.sh v2-lente --build-arg ARTIFICIAL_DELAY_MS=800; then
  echo "⚠️ La v2 défectueuse a été acceptée : le contrôle de performance n'a pas fonctionné."
fi

step "Vérifications"
version=$(curl -sf "$API_URL/" | node -p 'JSON.parse(require("fs").readFileSync(0)).version')
movie=$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/movies/$id")
after=$(movie_count)
check() { if [ "$2" = "$3" ]; then echo "✅ $1 : $2"; else echo "❌ $1 : $2 (attendu : $3)"; FAILED=1; fi; }
FAILED=0
check "Version en service après rollback" "$version" "v1"
check "Film créé avant la v2 toujours présent (HTTP)" "$movie" "200"
check "Nombre de films conservé" "$after" "$before"
echo
tail -3 "$STATE_DIR/history.log"
exit $FAILED
