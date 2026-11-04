# Repo instructions

This repo is a black-box web QA kit built on the Playwright library (Node 18+, TypeScript for the suite). No MCP servers are used or required.

- `scripts/crawl.mjs`: read-only crawler (GET only). Collects status, headers, console errors, failed requests, axe-core results, DOM/SEO facts, screenshots.
- `scripts/report.mjs`: turns `site-map.json` (+ `manual-findings.json`) into `findings.json`, `report.md`, `report.html`, `findings.csv`.
- `suite/`: Playwright Test project (TypeScript), data-driven from the crawl.

Never modify the site under test. For QA tasks use the `site-tester` agent (`/test-site`).
