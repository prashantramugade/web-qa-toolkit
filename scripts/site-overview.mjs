#!/usr/bin/env node
// Prints a compact digest of a crawl, so the raw site-map.json never needs to be read.
// Usage: node scripts/site-overview.mjs <out>/site-map.json
import fs from 'node:fs';

const input = process.argv[2];
if (!input) { console.error('Usage: node scripts/site-overview.mjs <out>/site-map.json'); process.exit(1); }
const map = JSON.parse(fs.readFileSync(input, 'utf8'));
const meta = map.meta ?? {};

console.log(`Start: ${meta.startUrl}   Pages: ${map.pages.length}   Links checked: ${map.links?.length ?? 0}   axe: ${meta.axeAvailable ? 'yes' : 'NOT RUN'}   Logged in: ${meta.authenticated ? 'yes' : 'no'}`);
if (meta.queueRemaining) console.log(`${meta.queueRemaining} more page(s) were found but not visited (raise --max-pages).`);
console.log('\nstatus  ms     axe  console  forms  btns  title  /  url');
for (const p of map.pages) {
  const row = [
    String(p.status ?? 'ERR').padEnd(7),
    String(p.loadMs ?? '-').padEnd(6),
    String(p.a11y ? p.a11y.violations.length : 'n/a').padEnd(4),
    String((p.consoleErrors?.length ?? 0) + (p.pageErrors?.length ?? 0)).padEnd(8),
    String(p.forms?.length ?? 0).padEnd(6),
    String(p.buttons?.length ?? 0).padEnd(5),
    `${(p.title || '(no title)').slice(0, 36)}  /  ${p.url}${p.error ? `  [${p.error}]` : ''}`,
  ];
  console.log(row.join(' '));
}

const forms = map.pages.flatMap(p => (p.forms ?? []).map(f => ({ page: new URL(p.url).pathname, ...f })));
if (forms.length) {
  console.log('\nForms:');
  for (const f of forms) console.log(`  ${f.page}  ${f.method.toUpperCase()} ${new URL(f.action).pathname}  fields: ${f.fields.map(x => `${x.name || x.id}(${x.type}${x.required ? '*' : ''})`).join(', ')}`);
}
const broken = (map.links ?? []).filter(l => l.status === 0 || l.status >= 400);
if (broken.length) console.log(`\nBroken links:\n${broken.map(l => `  ${l.status} ${l.href}  (found on ${(l.foundOn ?? [])[0] ?? '?'})`).join('\n')}`);
const s = map.site ?? {};
console.log(`\nSite: robots ${s.robots?.status ?? '?'}, sitemap ${s.sitemap?.status ?? '?'}, security.txt ${s.securityTxt?.status ?? '?'}, unknown URL answers ${s.notFound?.status ?? '?'}${s.notFound?.status === 200 ? '  (soft 404)' : ''}`);
console.log('Screenshots are in the screenshots/ folder next to site-map.json.');
