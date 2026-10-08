#!/usr/bin/env bash
# Restauration de la base depuis une sauvegarde (dernier recours, si une version a abîmé les DONNÉES).
# ⚠️ Remplace le contenu actuel : tout ce qui a été écrit depuis la sauvegarde est perdu.
#    Une sauvegarde de l'état actuel est faite juste avant, pour pouvoir revenir en arrière.
# Usage : scripts/restore.sh <fichier backups/….archive.gz> [--yes]
set -uo pipefail
cd "$(dirname "$0")/.."
source scripts/deploy-lib.sh

FILE=${1:?Usage : scripts/restore.sh <fichier .archive.gz> [--yes]}
[ -f "$FILE" ] || { echo "Sauvegarde introuvable : $FILE"; exit 1; }
if [ "${2:-}" != "--yes" ]; then
  read -r -p "Remplacer la base par $FILE ? Les écritures postérieures seront perdues (oui/non) : " answer
  [ "$answer" = "oui" ] || { echo "Annulé."; exit 1; }
fi

step "Sauvegarde de l'état actuel avant restauration"
backup "avant-restauration"
step "Restauration de $FILE"
docker compose exec -T mongo mongorestore --quiet --drop --archive --gzip < "$FILE" && echo "✅ Base restaurée."
log_history "restore $FILE"
