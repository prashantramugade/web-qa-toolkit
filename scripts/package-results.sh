#!/usr/bin/env bash
# Bundles the report, evidence and suite (without node_modules) into one zip.
# Usage: bash scripts/package-results.sh <out-dir> <suite-dir> <dest-dir>
set -euo pipefail

OUT="${1:?qa output folder}"; SUITE="${2:?suite folder}"; DEST="${3:?destination folder}"
mkdir -p "$DEST"
STAMP="$(date +%Y%m%d-%H%M)"
ZIP="$(cd "$DEST" && pwd)/qa-results-$STAMP.zip"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp -R "$OUT" "$TMP/qa-out"
rm -rf "$TMP/qa-out/suite"
[ -d "$SUITE" ] && { mkdir -p "$TMP/suite"; (cd "$SUITE" && tar --exclude=node_modules --exclude=results --exclude=test-results -cf - .) | (cd "$TMP/suite" && tar -xf -); }

(cd "$TMP" && zip -qr "$ZIP" .)
echo "Packaged: $ZIP"
