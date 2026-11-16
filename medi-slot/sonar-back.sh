#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[ -z "${SONAR_TOKEN:-}" ] && [ -f .env ] && { set -a; . ./.env; set +a; }
: "${SONAR_TOKEN:?SONAR_TOKEN absent : read -s SONAR_TOKEN && export SONAR_TOKEN, ou le mettre dans .env}"

docker run --rm -v medislot-m2:/m2 maven:3.9-eclipse-temurin-25 chown "$(id -u):$(id -g)" /m2

docker run --rm \
  --user "$(id -u):$(id -g)" --group-add "$(stat -c %g /var/run/docker.sock)" \
  --add-host=host.docker.internal:host-gateway \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v medislot-m2:/var/maven/.m2 \
  -v "$(git rev-parse --show-toplevel)":/repo \
  -w "/repo/$(git rev-parse --show-prefix)backend" \
  -e HOME=/var/maven -e MAVEN_CONFIG=/var/maven/.m2 -e SONAR_USER_HOME=/var/maven/.m2/.sonar \
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal \
  -e SONAR_TOKEN \
  maven:3.9-eclipse-temurin-25 \
  mvn -B -Duser.home=/var/maven \
    org.jacoco:jacoco-maven-plugin:0.8.16:prepare-agent \
    verify \
    org.jacoco:jacoco-maven-plugin:0.8.16:report \
    org.sonarsource.scanner.maven:sonar-maven-plugin:5.8.0.7211:sonar \
    -Dsonar.host.url=http://host.docker.internal:9000 \
    -Dsonar.projectKey=medislot-defauts-backend \
    -Dsonar.projectName="MediSlot défauts · backend" \
    "$@"
