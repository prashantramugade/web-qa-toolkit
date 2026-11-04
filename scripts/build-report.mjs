#!/usr/bin/env node
// Merges auto + manual findings (and optional Playwright results) into the final report.
// Usage: node scripts/build-report.mjs --out qa-out [--pw-results suite/results/results.json] [--title "QA report - App"]
// Writes: findings.json, findings.csv, report.md, report.html
//
// manual-findings.json is an array of {severity, category, page, summary, detail, steps, expected, actual, evidence, fix, confidence}.
//   - "supersedes": ["text"]  drops auto findings whose key contains any of these texts (de-duplication)
// suppressions.json (optional) is an array of {match, reason}: auto findings whose key contains `match` are dropped and listed in the report.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : d; };
const out = opt('out', 'qa-out');
const title = opt('title', 'QA report');
const pwResults = opt('pw-results');
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);

const map = readJson(path.join(out, 'site-map.json'), { pages: [], startUrl: '', crawledAt: '' });
let auto = readJson(path.join(out, 'auto-findings.json'), []);
const manual = readJson(path.join(out, 'manual-findings.json'), []);
const suppressions = readJson(path.join(out, 'suppressions.json'), []);

// De-duplicate and suppress
const superseded = manual.flatMap(m => m.supersedes ?? []);
const suppressed = [];
auto = auto.filter(f => {
  if (superseded.some(s => f.key.includes(s))) return false;
  const rule = suppressions.find(s => f.key.includes(s.match));
  if (rule) { suppressed.push({ summary: f.summary, page: f.page, reason: rule.reason }); return false; }
  return true;
});

// Failed Playwright tests become findings (walk the JSON reporter tree)
const suiteFindings = [];
if (pwResults && fs.existsSync(pwResults)) {
  const walk = s => {
    for (const spec of s.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const last = t.results?.[t.results.length - 1];
        if (last && last.status !== 'passed' && last.status !== 'skipped') {
          suiteFindings.push({
            source: 'suite', severity: 'medium', category: 'suite', page: spec.file ?? '',
            summary: `Failed test: ${spec.title} [${t.projectName ?? ''}]`,
            detail: (last.error?.message ?? '').split('\n').slice(0, 4).join('\n'),
          });
        }
      }
    }
    (s.suites ?? []).forEach(walk);
  };
  walk(readJson(pwResults, {}));
}

const all = [...auto, ...manual.map(m => ({ source: 'manual', ...m })), ...suiteFindings];
const rank = { critical: 0, high: 1, medium: 2, low: 3 };
all.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
all.forEach((f, i) => { f.id = `F-${String(i + 1).padStart(3, '0')}`; });

const counts = all.reduce((a, f) => ((a[f.severity] = (a[f.severity] ?? 0) + 1), a), {});
const countText = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'no findings';
const notCovered = [
  'Logged-in areas unless a storage state was supplied',
  'Business-logic flows beyond those listed in manual findings',
  'Pages not reachable through plain links (e.g. single-page-app routes)',
  ...(map.pages.some(p => p.axeSkipped) ? ['Automated accessibility scan (axe-core was not installed)'] : []),
];

fs.writeFileSync(path.join(out, 'findings.json'), JSON.stringify(all, null, 2));
const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
fs.writeFileSync(path.join(out, 'findings.csv'),
  ['id,severity,category,page,summary,source', ...all.map(f => [f.id, f.severity, f.category, f.page, f.summary, f.source].map(q).join(','))].join('\n'));

const md = [
  `# ${title}`, '',
  `Start URL: ${map.startUrl}  `, `Crawled ${map.pages.length} page(s) on ${map.crawledAt}.`, '',
  `**Result:** ${countText}`, '',
  ...all.map(f => [
    `### ${f.id} [${f.severity}] ${f.summary}`,
    `- Category: ${f.category}  |  Source: ${f.source}`,
    `- Page: ${f.page}`,
    f.steps ? `- Steps: ${f.steps}` : '', f.expected ? `- Expected: ${f.expected}` : '', f.actual ? `- Actual: ${f.actual}` : '',
    f.detail ? `- Detail: ${f.detail.replace(/\n/g, ' / ')}` : '', f.evidence ? `- Evidence: ${f.evidence}` : '',
    f.fix ? `- Suggested fix / reference: ${f.fix}` : '', '',
  ].filter(Boolean).join('\n')),
  '## Not covered', ...notCovered.map(n => `- ${n}`),
  ...(suppressed.length ? ['', '## Suppressed', ...suppressed.map(s => `- ${s.summary} (${s.page}): ${s.reason}`)] : []),
].join('\n');
fs.writeFileSync(path.join(out, 'report.md'), md);

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const colour = { critical: '#b00020', high: '#d9534f', medium: '#e69500', low: '#6c757d' };
fs.writeFileSync(path.join(out, 'report.html'), `<!doctype html><meta charset=utf-8><title>${esc(title)}</title>
<style>body{font:15px system-ui;max-width:920px;margin:2rem auto;padding:0 1rem}.f{border-left:4px solid;padding:.4rem .8rem;margin:.6rem 0;background:#f7f7f7}pre{white-space:pre-wrap;margin:.2rem 0}small{color:#555}</style>
<h1>${esc(title)}</h1><p>${esc(map.startUrl)} &middot; ${map.pages.length} pages &middot; <b>${esc(countText)}</b></p>
${all.map(f => `<div class=f style="border-color:${colour[f.severity] ?? '#999'}"><b>${f.id} [${f.severity}]</b> ${esc(f.summary)}<br><small>${esc(f.category)} &middot; ${esc(f.page)}</small>${f.detail ? `<pre>${esc(f.detail)}</pre>` : ''}${f.fix ? `<small>${esc(f.fix)}</small>` : ''}</div>`).join('\n')}
<h2>Not covered</h2><ul>${notCovered.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`);

console.log(`Report: ${all.length} findings (${countText}) -> ${out}/report.html, report.md, findings.csv, findings.json`);
