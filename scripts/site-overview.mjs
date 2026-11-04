#!/usr/bin/env node
// Prints a compact digest of a crawl, so the raw site-map.json never needs to be read.
// Usage: node scripts/site-overview.mjs <out>/site-map.json
import fs from 'node:fs';

const input = process.argv[2];
if (!input) { console.error('Usage: node scripts/site-overview.mjs <out>/site-map.json'); process.exit(1); }
const map = JSON.parse(fs.readFileSync(input, 'utf8'));

console.log(`Start: ${map.startUrl}   Crawled: ${map.pages.length} page(s)   Link checks: ${map.linkChecks?.length ?? 0}\n`);
console.log('status  ms     axe  console  forms  title / url');
for (const p of map.pages) {
  const d = p.dom ?? {};
  const row = [
    String(p.status ?? 'ERR').padEnd(7),
    String(p.loadMs ?? '-').padEnd(6),
    String(p.axeSkipped ? 'n/a' : (p.axe?.length ?? 0)).padEnd(4),
    String(p.consoleErrors?.length ?? 0).padEnd(8),
    String(d.forms ?? 0).padEnd(6),
    `${(d.title || '(no title)').slice(0, 40)}  ${p.url}`,
  ];
  console.log(row.join(' '));
}
const broken = (map.linkChecks ?? []).filter(l => l.status === 0 || l.status >= 400);
if (broken.length) console.log(`\nBroken links: ${broken.map(l => `${l.status} ${l.url}`).join('\n              ')}`);
if (map.pages.some(p => p.axeSkipped)) console.log('\nNote: axe-core scan was skipped (package not installed).');
