# web-qa-toolkit

Point it at a URL and it tests the site like a QA engineer: it crawls, checks accessibility, security headers, responsive layout, SEO and links, and writes a ranked report. It can also generate a Playwright (TypeScript) test suite. It only reads the site, it never changes it.

Runs in VS Code with GitHub Copilot agent mode. No MCP server needed.

## Setup

```
npm run setup
```

Needs Node 18+. This installs the dependencies and the Chromium browser.

## Use

In Copilot Chat, choose the **site-tester** agent (or type `/test-site`) and give it a URL:

> QA https://staging.example.com

It asks about depth, environment, login and deliverables once, then runs and writes the results to a `qa-out-...` folder (`report.html`, `report.md`, `findings.csv`).

## Layout

- `.github/agents/site-tester.agent.md`: the agent (rules and workflow)
- `references/`: test checklists, exploration playbook, report formats
- `scripts/`: crawler, analyzer, report builder, suite scaffolder
- `assets/suite-template/`: Playwright TypeScript project template
- `evals/`: demo app with seeded defects and `regression-check.sh` (run it before changing a script)
