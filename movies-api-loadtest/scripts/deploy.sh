#!/usr/bin/env bash
# Déploie une version de l'API sans toucher aux données, avec contrôle k6 et rollback automatique.
# Usage : scripts/deploy.sh <version> [options docker build]
#   ex. : scripts/deploy.sh v2
#         scripts/deploy.sh v2-lente --build-arg ARTIFICIAL_DELAY_MS=800   (version volontairement défectueuse)
# Code de sortie : 0 = version déployée, 1 = déploiement refusé (rollback effectué si possible).
set -uo pipefail
cd "$(dirname "$0")/.."
source scripts/deploy-lib.sh

TAG=${1:?Usage : scripts/deploy.sh <version> [options docker build]}
shift
PREVIOUS=$(current_version)

refuse() {
  echo "❌ Déploiement de $TAG refusé : $1"
  if [ -z "$PREVIOUS" ]; then
    echo "Aucune version précédente : l'API est arrêtée, les données restent intactes dans le volume."
    docker compose stop api
  elif [ "$PREVIOUS" = "$TAG" ]; then
    echo "La version refusée était déjà en service : à corriger manuellement."
  else
    step "Rollback automatique vers $PREVIOUS (données conservées)"
    switch_api "$PREVIOUS" && set_versions "$PREVIOUS" && echo "✅ Rollback effectué : $PREVIOUS est de nouveau en service."
  fi
  log_history "deploy $TAG refusé ($1) ; en service : $(current_version)"
  exit 1
}

step "1/5 Base de données (volume persistant mongo-data)"
docker compose up -d --wait mongo || { echo "MongoDB indisponible"; exit 1; }

step "2/5 Sauvegarde avant déploiement"
backup "avant-$TAG" || { echo "Sauvegarde impossible : déploiement annulé"; exit 1; }

step "3/5 Construction de l'image movies-api:$TAG"
docker build -q -t "movies-api:$TAG" --build-arg "APP_VERSION=$TAG" "$@" . || { echo "Build impossible : déploiement annulé, rien n'a changé"; exit 1; }

step "4/5 Remplacement du conteneur api : ${PREVIOUS:-aucune} → $TAG"
switch_api "$TAG" || refuse "l'API ne démarre pas correctement"

step "5/5 Contrôle de performance k6 (5 VUs, p95 < 500 ms, erreurs < 1 %, checks 100 %)"
perf_check || refuse "seuils de performance non respectés (détail : $STATE_DIR/last-check.txt)"

[ "$PREVIOUS" != "$TAG" ] && set_versions "$TAG" "$PREVIOUS" || set_versions "$TAG"
log_history "deploy $TAG ok (précédente : ${PREVIOUS:-aucune})"
echo "✅ $TAG déployée. Version de repli : ${PREVIOUS:-aucune}"
