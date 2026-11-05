# Repo instructions

Black-box web QA kit on the Playwright library (Node 18+, TypeScript for generated suites). No MCP servers. Runs on Windows, macOS and Linux.

- `scripts/` holds the crawler, analyzer, explorer, report builder and suite scaffolder.
- `references/` holds the test checklists, the exploration playbook and report formats.
- `assets/suite-template/` is the Playwright test project the scaffolder copies (specs, page objects, helpers).
- Never modify the site under test. On production use only `--env readonly` for exploration. For QA requests use the `site-tester` agent (`/test-site`).
- Before changing a script run `npm run check`.
