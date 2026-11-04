#!/usr/bin/env node
// Turns site-map.json (+ optional manual-findings.json) into findings.json, report.md, report.html, findings.csv
// Usage: node scripts/report.mjs [--out qa-out] [--title "QA report - App"]
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : d; };
const out = opt('out', 'qa-out');
const title = opt('title', 'QA report');
const map = JSON.parse(fs.readFileSync(path.join(out, 'site-map.json'), 'utf8'));
const manualPath = path.join(out, 'manual-findings.json');
const manual = fs.existsSync(manualPath) ? JSON.parse(fs.readFileSync(manualPath, 'utf8')) : [];

const F = [];
const add = (severity, category, page, summary, detail = '', fix = '') => F.push({ severity, category, page, summary, detail, fix });
const impactToSev = { critical: 'high', serious: 'high', moderate: 'medium', minor: 'low' };
const wanted = ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'referrer-policy'];

for (const p of map.pages) {
  const u = p.url;
  if (p.error) { add('high', 'functional', u, 'Page failed to load', p.error); continue; }
  if (p.status >= 400) { add('high', 'functional', u, `HTTP ${p.status}`); continue; }
  for (const v of p.axe ?? []) add(impactToSev[v.impact] ?? 'low', 'accessibility', u, `${v.help} (${v.id}, ${v.nodes} node${v.nodes > 1 ? 's' : ''})`, `e.g. ${v.sample}`, v.helpUrl);
  if (p.consoleErrors.length) add('medium', 'functional', u, `${p.consoleErrors.length} console error(s)`, p.consoleErrors.slice(0, 3).join('\n'));
  const bad = p.failedRequests.filter(r => !/favicon/.test(r));
  if (bad.length) add('medium', 'functional', u, `${bad.length} failed/4xx-5xx request(s)`, bad.slice(0, 5).join('\n'));
  if (p.mixed.length) add('high', 'security', u, 'Mixed content (http resources on https page)', p.mixed.slice(0, 3).join('\n'));
  if (u.startsWith('https:')) for (const h of wanted) if (!p.headers[h]) add('low', 'security', u, `Missing header: ${h}`);
  if (p.mobileOverflow) add('medium', 'responsive', u, 'Horizontal scroll at 390px width', 'Verified on a settled page.');
  const d = p.dom ?? {};
  if (!d.title) add('medium', 'seo', u, 'Missing <title>');
  if (!d.metaDescription) add('low', 'seo', u, 'Missing meta description');
  if (d.h1Count !== 1) add('low', 'seo', u, `Expected exactly one <h1>, found ${d.h1Count}`);
  if (p.axeSkipped) { // basic fallbacks only when axe did not run
    if (d.imagesNoAlt) add('medium', 'accessibility', u, `${d.imagesNoAlt} image(s) without alt attribute`);
    if (d.inputsNoLabel) add('medium', 'accessibility', u, `${d.inputsNoLabel} input(s) without an accessible label`);
    if (d.buttonsNoName) add('medium', 'accessibility', u, `${d.buttonsNoName} button(s) without an accessible name`);
  }
  if (!d.lang) add('medium', 'accessibility', u, 'Missing <html lang>');
  if (!d.viewportMeta) add('medium', 'responsive', u, 'Missing viewport meta tag');
  if (p.loadMs > 5000) add('medium', 'performance', u, `Slow load: ${p.loadMs} ms (settled)`);
}
for (const l of map.linkChecks) if (l.status === 0 || l.status >= 400) add('medium', 'links', l.url, `Broken link (${l.status || 'no response'})`);
for (const m of manual) F.push({ confidence: 'manual', ...m });

const order = { critical: 0, high: 1, medium: 2, low: 3 };
F.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
F.forEach((f, i) => { f.id = `F-${String(i + 1).padStart(3, '0')}`; });
const counts = F.reduce((a, f) => ((a[f.severity] = (a[f.severity] || 0) + 1), a), {});

fs.writeFileSync(path.join(out, 'findings.json'), JSON.stringify(F, null, 2));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const csv = ['id,severity,category,page,summary'].concat(F.map(f => [f.id, f.severity, f.category, f.page, f.summary].map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(','))).join('\n');
fs.writeFileSync(path.join(out, 'findings.csv'), csv);

const md = [`# ${title}`, '', `Crawled ${map.pages.length} page(s) from ${map.startUrl} on ${map.crawledAt}.`, '',
  `**Findings:** ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}`, '',
  ...F.map(f => `### ${f.id} [${f.severity}] ${f.summary}\n- Category: ${f.category}\n- Page: ${f.page}${f.detail ? `\n- Detail: ${f.detail}` : ''}${f.fix ? `\n- Reference/fix: ${f.fix}` : ''}\n`),
  '## Not covered', 'Authenticated areas, business-logic flows and anything not reachable by link crawl unless listed in manual findings.',
  ...(map.pages.some(p => p.axeSkipped) ? ['', '**Automated accessibility (axe-core) scan was NOT run** because @axe-core/playwright was not installed.'] : [])].join('\n');
fs.writeFileSync(path.join(out, 'report.md'), md);

const color = { critical: '#b00020', high: '#d9534f', medium: '#e69500', low: '#6c757d' };
const html = `<!doctype html><meta charset=utf-8><title>${esc(title)}</title>
<style>body{font:15px system-ui;max-width:900px;margin:2rem auto;padding:0 1rem}.f{border-left:4px solid;padding:.4rem .8rem;margin:.6rem 0;background:#f7f7f7}pre{white-space:pre-wrap;margin:.2rem 0}</style>
<h1>${esc(title)}</h1><p>${map.pages.length} pages crawled. ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ')}</p>
${F.map(f => `<div class=f style="border-color:${color[f.severity] ?? '#999'}"><b>${f.id} [${f.severity}]</b> ${esc(f.summary)}<br><small>${esc(f.category)} · ${esc(f.page)}</small>${f.detail ? `<pre>${esc(f.detail)}</pre>` : ''}</div>`).join('\n')}`;
fs.writeFileSync(path.join(out, 'report.html'), html);
console.log(`Report: ${F.length} findings -> ${out}/report.html, report.md, findings.csv, findings.json`);
