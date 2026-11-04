#!/usr/bin/env node
// Creates a ready-to-run Playwright (TypeScript) suite from the template, seeded with the crawled pages.
// Usage: node scripts/scaffold-suite.mjs <dest-dir> <base-url> <path/to/site-map.json>
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
const pages = [...new Set(
  map.pages
    .filter(p => !p.error && p.status < 400)
    .map(p => { const u = new URL(p.url); return u.pathname + u.search; }),
)];
fs.writeFileSync(path.join(dest, 'qa.config.json'), JSON.stringify({ baseURL, pages, skipChecks: [] }, null, 2));

console.log(`Suite scaffolded in ${dest} with ${pages.length} page(s)`);
console.log(`Run it:  npx playwright test -c ${dest} --project=chromium`);
