# web-qa-toolkit

Point it at a URL and it tests the site like a QA engineer: it crawls, checks accessibility, security headers, responsive layout, SEO and links, and writes a ranked report. It can also generate a Playwright (TypeScript) test suite. It only reads the site, it never changes it.

Runs in VS Code with GitHub Copilot agent mode on Windows, macOS and Linux. Everything is Node: no Python, bash or MCP server needed.

## Setup

```
npm run setup
```

Needs Node 18+. This installs the dependencies and Playwright's Chromium browser (the default).

**Can't download a browser (e.g. restricted network)?** Use Chrome or Edge already installed on the machine instead: run `npm run setup:installed-browser`, then set `BROWSER_CHANNEL` to `chrome` (or `msedge`) before crawling or running the suite:

```
# macOS / Linux
export BROWSER_CHANNEL=chrome

# Windows PowerShell
$env:BROWSER_CHANNEL = "chrome"

# Windows cmd
set BROWSER_CHANNEL=chrome
``` Alternatively, point `PLAYWRIGHT_DOWNLOAD_HOST` at an internal mirror.

## Use

In Copilot Chat, choose the **site-tester** agent (or type `/test-site`) and give it a URL:

> QA https://your-staging-site.example

It asks about depth, environment, login and deliverables once, then runs and writes the results to a `qa-out-...` folder (`report.html`, `report.md`, `findings.csv`).

## Playwright test suite (TypeScript)

Choose **report + Playwright suite** when the agent asks about deliverables. It creates a ready-to-run TypeScript project in `qa-out-.../suite/` with smoke, accessibility, responsive, SEO and security tests for every page it found. The agent can also add app-specific journey tests under `tests/functional/`.

To create and run it yourself after a crawl:

```
node scripts/scaffold-suite.mjs qa-out/suite https://your-staging-site.example qa-out/site-map.json
npx playwright test -c qa-out/suite --project=chromium
```

The suite is plain Playwright Test, so you can copy the folder into any project and run it in CI. Edit `qa.config.json` to change the base URL, add pages or turn checks off.

## Layout

- `.github/agents/site-tester.agent.md`: the agent (rules and workflow)
- `references/`: test checklists, exploration playbook, report formats
- `scripts/`: crawler, analyzer, report builder, suite scaffolder
- `assets/suite-template/`: Playwright TypeScript project template
- `evals/`: demo app with seeded defects and a regression check (`npm run check`, run it before changing a script)
