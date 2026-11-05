#!/usr/bin/env node
// Merges automatic, exploratory and manual findings (plus failed Playwright tests) into the final report.
// Usage: node scripts/build-report.mjs --out qa-out [--pw-results qa-out/suite/results/results.json] [--title "QA report - App"]
// Writes: findings.json, findings.csv, report.md, report.html
//
// Inputs in <out>:
//   auto-findings.json      analyze-crawl.mjs
//   explore-findings.json   explore.mjs
//   manual-findings.json    you, while testing by hand (format: references/report-format.md)
//   suppressions.json       optional [{ "rule": "seo-no-meta-description", "reason": "..." }]
//   exploration-log.json    explore.mjs (used for the coverage section)
//   app-profile.json        optional, shown at the top of the report
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : d; };
const out = opt('out', 'qa-out');
const title = opt('title', 'QA report');
const pwResults = opt('pw-results');
const read = (f, d) => { const p = path.join(out, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : d; };

const map = read('site-map.json', { meta: {}, pages: [] });
const profile = read('app-profile.json', null);
const exploration = read('exploration-log.json', null);
const suppressions = read('suppressions.json', []);
const manual = read('manual-findings.json', []).map(m => ({ source: 'manual', confidence: 'confirmed', ...m, pages: m.pages ?? (m.page ? [m.page] : []) }));
let machine = [...read('auto-findings.json', []), ...read('explore-findings.json', [])];

// de-duplicate: a manual finding can replace machine findings by rule id
const replaced = new Set(manual.flatMap(m => m.supersedes ?? []));
const suppressed = [];
machine = machine.filter(f => {
  if (replaced.has(f.rule)) return false;
  const rule = suppressions.find(s => s.rule === f.rule || (s.match && f.rule.includes(s.match)));
  if (rule) { suppressed.push({ summary: f.summary, reason: rule.reason }); return false; }
  return true;
});

// failed Playwright tests become findings
const suite = [];
if (pwResults && fs.existsSync(pwResults)) {
  const ansi = /\u001b\[[0-9;]*m/g; // terminal colour codes inside Playwright's error text
  const walk = (s, page = '') => {
    for (const spec of s.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const last = t.results?.[t.results.length - 1];
        if (!last || ['passed', 'skipped'].includes(last.status)) continue;
        const message = (last.error?.message ?? '').replace(ansi, '').split('\n').map(l => l.trimEnd()).filter(Boolean);
        suite.push({ source: 'suite', rule: `suite:${spec.title}`, severity: 'medium', category: 'suite', confidence: 'high', pages: [page || spec.file || ''],
          summary: `Failed test: ${spec.title} [${t.projectName ?? ''}]`, details: [message.slice(0, 10).join('\n')], actual: '', expected: '', fix: '', standards: [], evidence: [] });
      }
    }
    for (const child of s.suites ?? []) walk(child, /\.[jt]s$/.test(child.title) ? page : child.title); // nested describe blocks are titled with the page path
  };
  walk(JSON.parse(fs.readFileSync(pwResults, 'utf8')));
}

const all = [...machine, ...manual, ...suite];
const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
all.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || String(a.category).localeCompare(b.category));
all.forEach((f, i) => { f.id = `F-${String(i + 1).padStart(3, '0')}`; f.pages = f.pages ?? []; f.details = f.details ?? []; f.evidence = Array.isArray(f.evidence) ? f.evidence : (f.evidence ? [f.evidence] : []); });

const counts = all.reduce((a, f) => ((a[f.severity] = (a[f.severity] ?? 0) + 1), a), {});
const countText = ['critical', 'high', 'medium', 'low', 'info'].filter(k => counts[k]).map(k => `${counts[k]} ${k}`).join(', ') || 'no findings';
const byCategory = all.reduce((a, f) => ((a[f.category] = (a[f.category] ?? 0) + 1), a), {});

const covered = exploration
  ? [`Exploration mode: **${exploration.meta.env}**${exploration.meta.env === 'readonly' ? ' (all write requests blocked; nothing was submitted)' : ' (forms submitted with fake data)'}`,
     `${exploration.summary.pages} page(s) explored: ${exploration.summary.forms} form(s) in ${exploration.summary.formCases} case(s), ${exploration.summary.searches} search form(s), ${exploration.summary.controls} button(s), keyboard walk and back/forward navigation.`]
  : ['Exploration was not run (no exploration-log.json): functional behaviour was checked only through page loads.'];
const notCovered = [
  'Logged-in areas unless a storage state was supplied',
  'Business rules, prices, copy and visual design beyond what is listed in manual findings',
  'Pages not reachable through plain links (for example single-page-app routes)',
  ...(exploration?.meta.env === 'readonly' ? ['Server-side validation and success paths of forms (read-only mode never sends a write request)'] : []),
  ...(map.pages.some(p => p.axeSkipped) ? ['Automated accessibility scan (axe-core was not installed); only basic DOM checks ran'] : []),
];

fs.writeFileSync(path.join(out, 'findings.json'), JSON.stringify(all, null, 2));
const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
fs.writeFileSync(path.join(out, 'findings.csv'), ['id,severity,category,confidence,source,rule,summary,pages'].concat(all.map(f => [f.id, f.severity, f.category, f.confidence, f.source, f.rule ?? '', f.summary, f.pages.join(' ')].map(q).join(','))).join('\n'));

const pageList = f => (f.pages.length > 3 ? `${f.pages.slice(0, 3).join(', ')} (+${f.pages.length - 3} more)` : f.pages.join(', '));
const md = [
  `# ${title}`, '',
  `Start URL: ${map.meta.startUrl ?? ''}  `, `Crawled ${map.pages.length} page(s) on ${map.meta.crawledAt ?? ''}.`, '',
  ...(profile ? [`**App:** ${profile.purpose ?? ''} (${profile.type ?? ''})`, ''] : []),
  `**Result:** ${countText}`, '', `By category: ${Object.entries(byCategory).map(([k, v]) => `${k} ${v}`).join(', ')}`, '',
  ...all.map(f => [
    `### ${f.id} [${f.severity}] ${f.summary}`,
    `- Category: ${f.category}  |  Source: ${f.source}  |  Confidence: ${f.confidence}`,
    f.pages.length ? `- Pages: ${pageList(f)}` : '',
    f.steps ? `- Steps: ${f.steps}` : '', f.expected ? `- Expected: ${f.expected}` : '', f.actual ? `- Actual: ${f.actual}` : '',
    f.details.length ? `- Detail: ${f.details.slice(0, 4).join(' / ').replace(/\n/g, ' / ')}` : '',
    f.evidence.length ? `- Evidence: ${f.evidence.join(', ')}` : '',
    f.fix ? `- Suggested fix: ${f.fix}` : '', f.standards?.length ? `- Standards: ${f.standards.join(', ')}` : '', '',
  ].filter(Boolean).join('\n')),
  '## What was explored', ...covered.map(c => `- ${c}`), '',
  '## Not covered', ...notCovered.map(n => `- ${n}`),
  ...(suppressed.length ? ['', '## Suppressed', ...suppressed.map(s => `- ${s.summary}: ${s.reason}`)] : []),
].join('\n');
fs.writeFileSync(path.join(out, 'report.md'), md);

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const colour = { critical: '#b00020', high: '#d9534f', medium: '#e69500', low: '#6c757d', info: '#3b82f6' };
fs.writeFileSync(path.join(out, 'report.html'), `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:15px/1.45 system-ui;max-width:920px;margin:2rem auto;padding:0 1rem;color:#1f2937}.f{border-left:4px solid;padding:.5rem .9rem;margin:.7rem 0;background:#f7f7f7;border-radius:0 6px 6px 0}.f b{font-size:15px}small{color:#555}pre{white-space:pre-wrap;margin:.3rem 0;font-size:13px}.tag{display:inline-block;font-size:12px;padding:0 6px;border-radius:9px;background:#e5e7eb;margin-left:6px}img{max-width:100%;border:1px solid #ddd;margin-top:.4rem}</style>
<h1>${esc(title)}</h1><p>${esc(map.meta.startUrl)} &middot; ${map.pages.length} pages &middot; <b>${esc(countText)}</b></p>
${profile ? `<p>${esc(profile.purpose ?? '')} <small>(${esc(profile.type ?? '')})</small></p>` : ''}
${all.map(f => `<div class=f style="border-color:${colour[f.severity] ?? '#999'}"><b>${f.id} [${f.severity}]</b> ${esc(f.summary)}<span class=tag>${esc(f.category)}</span><span class=tag>${esc(f.source)}</span>${f.confidence === 'verify' ? '<span class=tag>verify</span>' : ''}<br>
<small>${esc(pageList(f))}</small>${f.steps ? `<pre>Steps: ${esc(f.steps)}</pre>` : ''}${f.actual ? `<pre>Actual: ${esc(f.actual)}</pre>` : ''}${f.expected ? `<pre>Expected: ${esc(f.expected)}</pre>` : ''}${f.details.length ? `<pre>${esc(f.details.slice(0, 3).join('\n'))}</pre>` : ''}${f.fix ? `<small>Fix: ${esc(f.fix)}</small>` : ''}${f.evidence.map(e => `<br><a href="${esc(e)}"><img src="${esc(e)}" alt="evidence for ${f.id}" width="360"></a>`).join('')}</div>`).join('\n')}
<h2>What was explored</h2><ul>${covered.map(c => `<li>${esc(c).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</li>`).join('')}</ul>
<h2>Not covered</h2><ul>${notCovered.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`);

console.log(`Report: ${all.length} findings (${countText}) -> ${out}/report.html, report.md, findings.csv, findings.json`);
