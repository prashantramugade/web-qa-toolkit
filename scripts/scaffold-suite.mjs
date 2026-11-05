#!/usr/bin/env node
// Creates a ready-to-run Playwright (TypeScript) suite from the template.
// It is seeded from the crawl (pages) and from the exploration (forms, searches and buttons that were found),
// so the generated functional tests mirror what was explored by hand.
// Usage: node scripts/scaffold-suite.mjs <dest-dir> <base-url> <path/to/site-map.json>
//   (exploration-log.json is read from the same folder as site-map.json when it exists)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [dest, baseURL, mapFile] = process.argv.slice(2);
if (!dest || !baseURL || !mapFile) {
  console.error('Usage: node scripts/scaffold-suite.mjs <dest-dir> <base-url> <site-map.json>');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(path.join(root, 'assets', 'suite-template'), dest, { recursive: true });

const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
const relative = u => { const x = new URL(u); return x.pathname + x.search; };
const pages = [...new Set(
  map.pages
    .filter(p => !p.error && !p.leftOrigin && p.status && p.status < 400 && /html/.test((p.headers ?? {})['content-type'] ?? 'html'))
    .map(p => relative(p.url)),
)];

// What exploration found (optional)
const explored = { forms: [], searches: [], controls: [] };
const logFile = path.join(path.dirname(mapFile), 'exploration-log.json');
if (fs.existsSync(logFile)) {
  const seen = new Set();
  const once = (key, fn) => { if (!seen.has(key)) { seen.add(key); fn(); } };
  for (const e of JSON.parse(fs.readFileSync(logFile, 'utf8')).entries ?? []) {
    if (e.kind === 'form') {
      once(`form|${e.path}|${e.form.index}`, () => explored.forms.push({
        path: e.path, index: e.form.index, method: e.form.method, submitText: e.form.submitText,
        hasPassword: e.form.fields.some(f => f.type === 'password'), fields: e.form.fields,
      }));
    } else if (e.kind === 'search') {
      once(`search|${e.path}|${e.param}`, () => explored.searches.push({ path: relative(e.page), action: e.action, param: e.param, term: e.term || '' }));
    } else if (e.kind === 'control' && e.hasQty) {
      once(`control|${e.path}|${e.text}`, () => explored.controls.push({ path: e.path, text: e.text, hasQty: true }));
    }
  }
}

const config = {
  baseURL,
  pages,
  skipChecks: [],
  ignoreFailedRequests: ['favicon'],
  ignoreConsole: [],
  perfBudgetMs: 4000,
  explored,
};
fs.writeFileSync(path.join(dest, 'qa.config.json'), JSON.stringify(config, null, 2));

console.log(`Suite scaffolded in ${dest}: ${pages.length} page(s), ${explored.forms.length} form(s), ${explored.searches.length} search(es), ${explored.controls.length} quantity button(s)`);
console.log(`Run it:  npx playwright test -c ${dest} --project=chromium`);
console.log('Tests that submit data are skipped unless ALLOW_WRITES=1 (use a test environment only).');
