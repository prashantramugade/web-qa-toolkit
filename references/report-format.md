# Report format

## Files in the output folder
| File | Written by |
|---|---|
| `site-map.json` | `crawl.mjs` (raw crawl data; read it through `site-overview.mjs`) |
| `auto-findings.json` | `analyze-crawl.mjs` (one finding per rule, listing every page) |
| `exploration-log.json`, `exploration-notes.md`, `explore-findings.json` | `explore.mjs` |
| `manual-findings.json` | you, while testing by hand |
| `suppressions.json` (optional) | you, to drop false positives with a reason |
| `app-profile.json` (optional) | you; shown at the top of the report |
| `findings.json`, `findings.csv`, `report.md`, `report.html` | `build-report.mjs` |
| `screenshots/` | crawler (desktop and mobile) and explorer (`explore-*.png`) |

## Finding fields
Every finding, whoever wrote it, has: `rule` (stable id, e.g. `explore-empty-submit-accepted`), `summary`, `category`
(functional, accessibility, security, seo, responsive, performance, ui-ux), `severity` (critical, high, medium, low, info),
`confidence` (`high` = reproduced or deterministic, `verify` = plausible, not proven), `pages` (list), and optionally
`steps`, `expected`, `actual`, `details`, `evidence`, `fix`, `standards`.

## manual-findings.json
An array. Record each defect as soon as you confirm it.
```json
[{
  "rule": "manual-contact-sends-nothing",
  "severity": "high",
  "category": "functional",
  "pages": ["https://example.com/contact"],
  "summary": "Contact form shows success but sends nothing",
  "steps": "1. Open /contact  2. Fill all fields  3. Press Send",
  "expected": "A request is sent and the confirmation appears",
  "actual": "Confirmation appears; no network request is made",
  "evidence": ["screenshots/contact-send.png"],
  "fix": "Wire the submit handler to the API call",
  "supersedes": ["explore-empty-submit-accepted"]
}]
```
- Write the summary as the problem ("Cart quantity doubles on add"), not as the test ("Test cart"). Put the user impact in `actual`.
- `confidence` defaults to `confirmed` for manual findings. Do not use `verify` for high or critical.
- `supersedes` lists rule ids of automatic or exploratory findings that describe the same defect; they are dropped so the issue appears once.

## suppressions.json
For automatic findings that are false positives or intentionally accepted. A reason is required and appears in the report.
```json
[{ "rule": "seo-no-meta-description", "reason": "Internal tool, not indexed by search engines" }]
```
`match` (a part of the rule id) works too: `{ "match": "seo-", "reason": "..." }`.

## Building the report
```
node scripts/build-report.mjs --out qa-out [--pw-results qa-out/suite/results/results.json] --title "QA report - App"
```
Failed Playwright tests are added as findings. The report ends with "What was explored" (from the exploration log) and
"Not covered". Do not edit the HTML by hand: fix the JSON and run the script again.

## Linking tests to findings
In a spec, add `test.info().annotations.push({ type: 'finding', description: 'F-012' })`.

## Final summary (what to tell the user)
Verdict in one line; the top three to five findings, one sentence each; counts by severity; what was explored and what was
not; where the files are; the command to re-run the suite if one was built.
