#!/usr/bin/env bash
# Runs crawler + analyzer against the demo app and checks the seeded defects are all found.
# Run this before changing any script:  bash evals/regression-check.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8765}"
OUT="$(mktemp -d)"

node "$ROOT/evals/demo-app/serve.mjs" "$PORT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true; rm -rf "$OUT"' EXIT
sleep 1

node "$ROOT/scripts/crawl.mjs" "http://localhost:$PORT" --out "$OUT" --max-pages 5 >/dev/null
node "$ROOT/scripts/analyze-crawl.mjs" "$OUT/site-map.json" >/dev/null

node -e '
const fs = require("fs");
const [findingsFile, casesFile] = process.argv.slice(1);
const findings = JSON.parse(fs.readFileSync(findingsFile, "utf8"));
const cases = JSON.parse(fs.readFileSync(casesFile, "utf8"));
const text = findings.map(f => f.summary + " " + f.page);
let bad = 0;
for (const e of cases.expected) if (!findings.some(f => f.summary.includes(e))) { console.log("MISSING  " + e); bad++; }
for (const n of cases.notExpected ?? []) if (findings.some(f => f.page.includes(n))) { console.log("UNEXPECTED finding on " + n); bad++; }
console.log(bad ? bad + " check(s) failed" : "OK: all " + cases.expected.length + " seeded defects found");
process.exit(bad ? 1 : 0);
' "$OUT/auto-findings.json" "$ROOT/evals/cases.json"
