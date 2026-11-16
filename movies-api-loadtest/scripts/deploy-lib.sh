STATE_DIR=.deploy
BACKUP_DIR=backups
API_URL=http://localhost:8080
mkdir -p "$STATE_DIR" "$BACKUP_DIR"

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
log_history() { printf '%s\t%s\n' "$(date -Iseconds)" "$*" >> "$STATE_DIR/history.log"; }
current_version() { cat "$STATE_DIR/current" 2>/dev/null || true; }
previous_version() { cat "$STATE_DIR/previous" 2>/dev/null || true; }
set_versions() { echo "$1" > "$STATE_DIR/current"; [ -n "${2:-}" ] && echo "$2" > "$STATE_DIR/previous"; return 0; }

backup() {
  local file="$BACKUP_DIR/$(date +%Y%m%d-%H%M%S)_$1.archive.gz"
  docker compose exec -T mongo mongodump --quiet --db sample_mflix --archive --gzip > "$file"
  echo "Sauvegarde : $file ($(du -h "$file" | cut -f1))"
  ls -1t "$BACKUP_DIR"/*.archive.gz | tail -n +11 | xargs -r rm --
}

switch_api() {
  API_TAG="$1" docker compose up -d --no-deps --wait --wait-timeout 60 api || return 1
  local served
  served=$(curl -sf "$API_URL/" | node -p 'JSON.parse(require("fs").readFileSync(0)).version' 2>/dev/null || true)
  [ "$served" = "$1" ] || { echo "La version servie est « $served » au lieu de « $1 »."; return 1; }
  echo "Version en service : $served ($API_URL)"
}

perf_check() {
  scripts/k6.sh run --quiet -e VUS=5 -e DURATION="${CHECK_DURATION:-20s}" -e BASE_URL="$API_URL" \
    load-tests/paliers.ts > "$STATE_DIR/last-check.txt" 2>&1
  local code=$?
  sed -n '/THRESHOLDS/,/TOTAL RESULTS/p' "$STATE_DIR/last-check.txt" | grep -E "✓|✗"
  return $code
}

movie_count() { curl -sf "$API_URL/movies?limit=1" | node -p 'JSON.parse(require("fs").readFileSync(0)).total'; }
