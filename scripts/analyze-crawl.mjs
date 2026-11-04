#!/usr/bin/env node
// Turns crawl data into automatic findings.
// Usage: node scripts/analyze-crawl.mjs <out>/site-map.json   ->   <out>/auto-findings.json
import fs from 'node:fs';
import path from 'node:path';

const input = process.argv[2];
if (!input) { console.error('Usage: node scripts/analyze-crawl.mjs <out>/site-map.json'); process.exit(1); }
const map = JSON.parse(fs.readFileSync(input, 'utf8'));

const findings = [];
const add = (severity, category, page, summary, detail = '', fix = '') =>
  findings.push({ key: `${category}|${page}|${summary}`, source: 'auto', severity, category, page, summary, detail, fix });

const axeSeverity = { critical: 'high', serious: 'high', moderate: 'medium', minor: 'low' };
const securityHeaders = ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'referrer-policy'];
const SLOW_MS = 5000;

for (const p of map.pages) {
  const url = p.url;
  if (p.error) { add('high', 'functional', url, 'Page failed to load', p.error); continue; }
  if (p.status >= 400) { add('high', 'functional', url, `Server answered HTTP ${p.status}`); continue; }

  for (const v of p.axe ?? []) {
    add(axeSeverity[v.impact] ?? 'low', 'accessibility', url,
      `${v.help} (${v.id}, ${v.nodes} element${v.nodes === 1 ? '' : 's'})`, `Example element: ${v.sample}`, v.helpUrl);
  }

  const d = p.dom ?? {};
  if (p.axeSkipped) {
    // Fallback checks, only used when the axe scan did not run
    if (d.imagesNoAlt) add('medium', 'accessibility', url, `${d.imagesNoAlt} image(s) without alt attribute`);
    if (d.inputsNoLabel) add('medium', 'accessibility', url, `${d.inputsNoLabel} input(s) without an accessible label`);
    if (d.buttonsNoName) add('medium', 'accessibility', url, `${d.buttonsNoName} button(s) without an accessible name`);
  }
  if (!d.lang) add('medium', 'accessibility', url, 'Page language not declared (<html lang>)');

  if (p.consoleErrors?.length) add('medium', 'functional', url, `${p.consoleErrors.length} console error(s)`, p.consoleErrors.slice(0, 3).join('\n'));
  const failed = (p.failedRequests ?? []).filter(r => !/favicon/i.test(r));
  if (failed.length) add('medium', 'functional', url, `${failed.length} failed or 4xx/5xx request(s)`, failed.slice(0, 5).join('\n'));

  if (p.mixed?.length) add('high', 'security', url, 'Insecure (http) resources loaded on an https page', p.mixed.slice(0, 3).join('\n'));
  if (url.startsWith('https:')) {
    for (const h of securityHeaders) if (!p.headers?.[h]) add('low', 'security', url, `Response header missing: ${h}`);
  }

  if (p.mobileOverflow) add('medium', 'responsive', url, 'Content overflows horizontally at 390px width');
  if (!d.viewportMeta) add('medium', 'responsive', url, 'No viewport meta tag');

  if (!d.title) add('medium', 'seo', url, 'Page has no <title>');
  if (!d.metaDescription) add('low', 'seo', url, 'No meta description');
  if (d.h1Count !== 1) add('low', 'seo', url, `Expected one <h1>, found ${d.h1Count}`);

  if (p.loadMs > SLOW_MS) add('medium', 'performance', url, `Slow page: ${p.loadMs} ms until settled`);
}

for (const l of map.linkChecks ?? []) {
  if (l.status === 0 || l.status >= 400) add('medium', 'links', l.url, `Broken link (${l.status || 'no response'})`);
}

const dir = path.dirname(input);
fs.writeFileSync(path.join(dir, 'auto-findings.json'), JSON.stringify(findings, null, 2));
console.log(`${findings.length} automatic findings -> ${path.join(dir, 'auto-findings.json')}`);
