# Report format

## Files in the output folder
| File | Written by |
|---|---|
| `site-map.json` | `crawl.mjs` (raw crawl data; read it through `site-overview.mjs`) |
| `auto-findings.json` | `analyze-crawl.mjs` |
| `manual-findings.json` | you, while testing by hand |
| `suppressions.json` (optional) | you, to drop false positives with a reason |
| `findings.json`, `findings.csv`, `report.md`, `report.html` | `build-report.mjs` |

## manual-findings.json
An array. Record each defect as soon as you confirm it.
```json
[{
  "severity": "high",
  "category": "functional",
  "page": "https://example.com/contact",
  "summary": "Contact form shows success but sends nothing",
  "steps": "1. Open /contact  2. Fill all fields  3. Press Send",
  "expected": "Request is sent and confirmation appears",
  "actual": "Confirmation appears; no network request is made",
  "evidence": "evidence/contact-send.png",
  "fix": "Wire the submit handler to the API call",
  "confidence": "confirmed",
  "supersedes": ["functional|https://example.com/contact"]
}]
```
- `severity`: critical | high | medium | low (see `test-categories.md`).
- `confidence`: `confirmed` (you reproduced it) or `verify` (not reproduced yet; never use for high/critical).
- `supersedes`: texts matched against auto-finding keys (`category|page|summary`); matching auto findings are dropped as duplicates.

## suppressions.json
```json
[{ "match": "seo|https://example.com/print", "reason": "Print view, intentionally has no meta description" }]
```

## Building the report
```
node scripts/build-report.mjs --out qa-out [--pw-results qa-out/suite/results/results.json] --title "QA report - App"
```
Failed Playwright tests are added as findings. Do not edit the HTML by hand: fix the JSON and run the script again.

## Linking tests to findings
In a spec, add `test.info().annotations.push({ type: 'finding', description: 'F-012' })`.

## Final summary (what to tell the user)
Verdict in one line; the top three to five findings, one sentence each; counts by severity; what was not covered; where the files are; the one-line command to re-run the suite if one was built.
