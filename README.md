# web-qa-toolkit

Point it at a URL and it tests the site like a QA engineer. It crawls the pages and checks accessibility, security headers, responsive layout, SEO, performance and links. It then **explores** the app the way a tester would: submits forms with empty and invalid input, searches with odd queries, clicks buttons and compares before and after, tabs through the page, and tries Back and Refresh. The result is a ranked report, and optionally a Playwright (TypeScript) test suite built from what the exploration found. It never changes the site, and on production it cannot send anything: every write request is blocked in the browser.

Runs on Windows, macOS and Linux. Everything is Node: no Python, bash or MCP server needed.

## Setup

Requires Node 18+. For the agent workflow, VS Code with GitHub Copilot (agent mode).

```
npm run setup
npm run check
```

`setup` installs the dependencies and Playwright's Chromium. `check` runs the toolkit against a built-in demo shop and should end with `OK:` and the number of seeded defects it found.

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
node scripts/explore.mjs --site-map qa-out/site-map.json --out qa-out --env readonly
node scripts/build-report.mjs --out qa-out --title "QA report"
```

Add `--storage-state auth/user.json` to the crawl and the exploration for logged-in pages.

**Exploration modes.** `--env readonly` (default) is safe on production: POST, PUT, PATCH and DELETE are blocked before they leave the browser, so nothing is created or sent. Use `--env staging` only on a test environment: forms are then really submitted, with fake data. In both modes it never fills a password field and never uses anything that looks destructive or like a payment.

Results in `qa-out/`: `report.html`, `report.md`, `findings.csv`, `findings.json`, `exploration-notes.md` (what it tried and saw), and screenshots in `screenshots/`.

## Playwright test suite (TypeScript)

Choose **report + Playwright suite** when the agent asks about deliverables. It creates a ready-to-run project in `qa-out-.../suite/`. For every page it has smoke, accessibility, keyboard, responsive, SEO, link, security and performance tests. The **functional tests are generated from the exploration**: each form, search and quantity button it found gets tests that repeat what it tried (empty and invalid submissions, odd search queries, cart arithmetic), plus back/forward and 404 checks. Tests that submit data are skipped unless you set `ALLOW_WRITES=1`, which you should do only against a test environment. The agent can add journey tests of its own under `tests/functional/`, using page objects.

To create and run it yourself after a crawl:

```
node scripts/scaffold-suite.mjs qa-out/suite https://your-staging-site.example qa-out/site-map.json
npx playwright test -c qa-out/suite --project=chromium
```

To include the tests that submit data (test environments only): `ALLOW_WRITES=1` before the second command (`export ALLOW_WRITES=1` on macOS/Linux, `$env:ALLOW_WRITES = "1"` in PowerShell).

It is plain Playwright Test, so you can copy the folder into any project or CI. Edit `qa.config.json` to change the base URL, add pages or turn checks off.

## Layout

- `.github/agents/site-tester.agent.md`: the agent (rules and workflow)
- `.github/prompts/test-site.prompt.md`: the `/test-site` command
- `references/`: test checklists, exploration playbook, report formats
- `scripts/`: crawler, analyzer, explorer, report builder, suite scaffolder, packaging
- `assets/suite-template/`: Playwright TypeScript project template (specs, page objects, helpers)
- `evals/`: a demo shop with seeded defects, `npm run check` (quick: every seeded defect must be found, and read-only mode must send nothing) and `npm run e2e` (full: crawl, explore, generated suite, report). Run `check` before changing a script.
