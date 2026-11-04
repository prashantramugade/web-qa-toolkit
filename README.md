# web-qa-toolkit

Point it at a URL and it tests the site like a QA engineer: it crawls, checks accessibility, security headers, responsive layout, SEO and links, and writes a ranked report. It can also generate a Playwright (TypeScript) test suite. It only reads the site, it never changes it.

Runs on Windows, macOS and Linux. Everything is Node: no Python, bash or MCP server needed.

## Setup

Requires Node 18+. For the agent workflow, VS Code with GitHub Copilot (agent mode).

```
npm run setup
npm run check
```

`setup` installs the dependencies and Playwright's Chromium. `check` runs the toolkit against a built-in demo app and should end with `OK: all 11 seeded defects found`.

### Restricted network or no browser download

Use Chrome or Edge that is already installed instead of Playwright's Chromium:

```
npm run setup:installed-browser
```

Then set `BROWSER_CHANNEL` to `chrome` (or `msedge`) in the same terminal before crawling or running the suite:

```
# macOS / Linux
export BROWSER_CHANNEL=chrome

# Windows PowerShell
$env:BROWSER_CHANNEL = "chrome"

# Windows cmd
set BROWSER_CHANNEL=chrome
```

Alternatively, point `PLAYWRIGHT_DOWNLOAD_HOST` at an internal mirror.

## Use

### With Copilot (recommended)

In Copilot Chat, choose the **site-tester** agent (or type `/test-site`) and give it a URL:

> QA https://your-staging-site.example

It asks about depth, environment, login and deliverables once, then runs and writes everything to a `qa-out-...` folder.

### By hand

```
node scripts/check-reachable.mjs https://your-staging-site.example
node scripts/crawl.mjs https://your-staging-site.example --out qa-out --max-pages 15
node scripts/analyze-crawl.mjs qa-out/site-map.json
node scripts/build-report.mjs --out qa-out --title "QA report"
```

Add `--storage-state auth/user.json` to the crawl for logged-in pages.

Results in `qa-out/`: `report.html`, `report.md`, `findings.csv`, `findings.json`, and screenshots in `evidence/`.

## Playwright test suite (TypeScript)

Choose **report + Playwright suite** when the agent asks about deliverables. It creates a ready-to-run project in `qa-out-.../suite/` with smoke, accessibility, responsive, SEO and security tests for every page found. The agent can also add app-specific journey tests under `tests/functional/`.

To create and run it yourself after a crawl:

```
node scripts/scaffold-suite.mjs qa-out/suite https://your-staging-site.example qa-out/site-map.json
npx playwright test -c qa-out/suite --project=chromium
```

It is plain Playwright Test, so you can copy the folder into any project or CI. Edit `qa.config.json` to change the base URL, add pages or turn checks off.

## Layout

- `.github/agents/site-tester.agent.md`: the agent (rules and workflow)
- `.github/prompts/test-site.prompt.md`: the `/test-site` command
- `references/`: test checklists, exploration playbook, report formats
- `scripts/`: crawler, analyzer, report builder, suite scaffolder, packaging
- `assets/suite-template/`: Playwright TypeScript project template
- `evals/`: demo app with seeded defects, `npm run check` (quick) and `npm run e2e` (full). Run `check` before changing a script.
