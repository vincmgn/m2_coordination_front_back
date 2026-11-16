#!/usr/bin/env bash
set -euo pipefail
VERSION=2.3.0
DIR="$(cd "$(dirname "$0")/.." && pwd)/.tools"
BIN="$DIR/k6"

if [[ ! -x "$BIN" ]]; then
  ARCHIVE="k6-v$VERSION-linux-amd64.tar.gz"
  URL="https://github.com/grafana/k6/releases/download/v$VERSION"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  echo "Téléchargement de k6 v$VERSION dans .tools/ ..."
  curl -fsSL -o "$TMP/$ARCHIVE" "$URL/$ARCHIVE"
  (cd "$TMP" && curl -fsSL "$URL/k6-v$VERSION-checksums.txt" | grep " $ARCHIVE\$" | sha256sum -c --quiet -)
  tar -xzf "$TMP/$ARCHIVE" -C "$TMP"
  mkdir -p "$DIR"
  mv "$TMP/k6-v$VERSION-linux-amd64/k6" "$BIN"
fi

export K6_NO_USAGE_REPORT=true
exec "$BIN" "$@"
