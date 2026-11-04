#!/usr/bin/env bash
# Creates a ready-to-run Playwright (TypeScript) suite from the template, seeded with the crawled pages.
# Usage: bash scripts/scaffold-suite.sh <dest-dir> <base-url> <path/to/site-map.json>
set -euo pipefail

DEST="${1:?destination folder}"; BASE_URL="${2:?base url}"; MAP="${3:?site-map.json}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$DEST"
cp -R "$ROOT/assets/suite-template/." "$DEST/"

node -e '
const fs = require("fs");
const [map, base, dest] = process.argv.slice(1);
const pages = JSON.parse(fs.readFileSync(map, "utf8")).pages
  .filter(p => !p.error && p.status < 400)
  .map(p => { const u = new URL(p.url); return u.pathname + u.search; });
fs.writeFileSync(dest + "/qa.config.json", JSON.stringify({ baseURL: base, pages: [...new Set(pages)], skipChecks: [] }, null, 2));
console.log("Suite scaffolded in " + dest + " with " + pages.length + " page(s)");
' "$MAP" "$BASE_URL" "$DEST"

echo "Run it:  cd $DEST && npx playwright test --project=chromium"
