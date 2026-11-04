# web-qa-toolkit

Black-box QA of a live web app from a URL, driven by GitHub Copilot (VS Code agent mode) and plain Playwright. **No MCP server needed.** The Playwright CLI is optional.

## How it crawls without MCP

`scripts/crawl.mjs` imports the Playwright **library** (`import { chromium } from 'playwright'`) and launches headless Chromium itself. It does a breadth-first walk: load a page, wait until it settles (`networkidle` + `document.fonts.ready`), read the DOM with `page.evaluate`, run axe-core, take a screenshot, collect same-origin `<a href>` links, repeat. It only does GET navigation: it never clicks, submits or types, so it is read-only.

Copilot's part is orchestration: the agent file tells it to run `npm run crawl`, read the JSON output, write extra Playwright scripts for hands-on journeys, and build the report. It runs these through its terminal tool, so no MCP browser tools are involved. (MCP would only matter if you wanted the model to click around live, step by step. Scripts replace that.)

## Setup (once)

```
npm run setup        # npm install + npx playwright install chromium
```

Needs Node 18+. `npx playwright install` downloads the browser binary; that is the only time the Playwright CLI is used.

## Use

In VS Code Copilot Chat: pick the **site-tester** agent (or run `/test-site`) and give it a URL. It asks depth / environment / login / deliverables once, then runs.

By hand:

```
npm run crawl -- https://staging.example.com --out qa-out --max-pages 15
npm run report -- --out qa-out --title "QA report - MyApp"
BASE_URL=https://staging.example.com npm run suite -- --project=chromium   # optional suite
```

Outputs in `qa-out/`: `report.html`, `report.md`, `findings.csv`, `findings.json`, `site-map.json`, `evidence/*.png`.

## What it checks

Status codes, console and network errors, mixed content, security headers (passive), axe-core WCAG A/AA, SEO basics, broken links (HEAD), mobile overflow at 390px, load time. Hands-on journeys and form validation come from the agent's own scripts in Standard/Deep mode.

## Limits

- Link crawl only: SPA routes without `<a href>` and logged-in areas need agent-written scripts (use `--storage-state auth.json`).
- If `@axe-core/playwright` is missing, the crawler warns, falls back to basic alt/label checks, and the report says axe was not run.
- Rules of engagement (report only, no fixing, passive security, no submits on production) are in `.github/agents/site-tester.agent.md`.
- Corporate networks: allow the npm registry and the Playwright browser download host, or install the browser from your internal mirror.

## Layout

```
.github/copilot-instructions.md      repo-wide context
.github/agents/site-tester.agent.md   the QA agent (rules + workflow)
.github/prompts/test-site.prompt.md    /test-site entry point
scripts/crawl.mjs                    crawler
scripts/report.mjs                   report builder
suite/                               Playwright Test (TypeScript), data-driven from the crawl
```
