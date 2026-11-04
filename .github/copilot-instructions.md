# Repo instructions

Black-box web QA kit on the Playwright library (Node 18+, TypeScript for generated suites). No MCP servers.

- `scripts/` holds the crawler, analyzer, report builder and suite scaffolder.
- `references/` holds the test checklists and report formats.
- Never modify the site under test. For QA requests use the `site-tester` agent (`/test-site`).
