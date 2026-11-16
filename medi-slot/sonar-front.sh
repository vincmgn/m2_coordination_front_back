#!/usr/bin/env bash
# Tests Vitest + couverture lcov, puis analyse SonarQube du front (frontend/sonar-project.properties).
# Usage : read -s SONAR_TOKEN && export SONAR_TOKEN ; ./sonar-front.sh [-Dsonar.projectVersion=1.1 ...]
set -euo pipefail
cd "$(dirname "$0")"
# Jeton local optionnel : .env (ignoré par Git) contenant SONAR_TOKEN=...
[ -z "${SONAR_TOKEN:-}" ] && [ -f .env ] && { set -a; . ./.env; set +a; }
: "${SONAR_TOKEN:?SONAR_TOKEN absent : read -s SONAR_TOKEN && export SONAR_TOKEN, ou le mettre dans .env}"
repo="$(git rev-parse --show-toplevel)"
front="/repo/$(git rev-parse --show-prefix)frontend"

docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$repo":/repo -w "$front" \
  node:22 sh -c "npm ci && npx vitest run --coverage"

# Le dépôt est monté entier pour que SonarQube lise l'historique Git (date du nouveau code).
docker run --rm --user "$(id -u):$(id -g)" \
  --add-host=host.docker.internal:host-gateway \
  -v "$repo":/repo -w "$front" \
  -e SONAR_HOST_URL=http://host.docker.internal:9000 \
  -e SONAR_TOKEN \
  sonarsource/sonar-scanner-cli:12.2 \
  -Dsonar.projectBaseDir="$front" -Dsonar.working.directory=/tmp/.scannerwork "$@"
