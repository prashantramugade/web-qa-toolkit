#!/usr/bin/env node
// Runs the crawler and analyzer against the demo app and checks that every seeded defect is found.
// Run before changing any script:  npm run check
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.PORT ?? '8765';
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-regression-'));
const node = process.execPath;

const server = spawn(node, [path.join(root, 'evals', 'demo-app', 'serve.mjs'), port], { stdio: 'ignore' });
const cleanup = () => { server.kill(); fs.rmSync(out, { recursive: true, force: true }); };

try {
  await new Promise(r => setTimeout(r, 1000));
  const run = (script, ...args) => {
    const r = spawnSync(node, [path.join(root, 'scripts', script), ...args], { encoding: 'utf8' });
    if (r.status !== 0) { console.error(r.stdout + r.stderr); throw new Error(`${script} failed`); }
  };
  run('crawl.mjs', `http://localhost:${port}`, '--out', out, '--max-pages', '5');
  run('analyze-crawl.mjs', path.join(out, 'site-map.json'));

  const findings = JSON.parse(fs.readFileSync(path.join(out, 'auto-findings.json'), 'utf8'));
  const cases = JSON.parse(fs.readFileSync(path.join(root, 'evals', 'cases.json'), 'utf8'));
  let bad = 0;
  for (const e of cases.expected) {
    if (!findings.some(f => f.summary.includes(e))) { console.log(`MISSING     ${e}`); bad++; }
  }
  for (const n of cases.notExpected ?? []) {
    if (findings.some(f => f.page.includes(n))) { console.log(`UNEXPECTED  finding on ${n}`); bad++; }
  }
  console.log(bad ? `${bad} check(s) failed` : `OK: all ${cases.expected.length} seeded defects found`);
  process.exitCode = bad ? 1 : 0;
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}
