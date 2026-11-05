#!/usr/bin/env node
// Runs crawler, analyzer and the read-only explorer against the demo shop and checks that
//   1. every seeded defect is found (evals/cases.json),
//   2. known false-positive traps stay quiet,
//   3. read-only mode never sends a write request (the demo server logs every one it receives).
// Run before changing any script:  npm run check
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.PORT ?? '8765';
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-regression-'));
const postLog = path.join(out, 'writes.log');
const node = process.execPath;

const server = spawn(node, [path.join(root, 'evals', 'demo-app', 'serve.mjs'), port], { stdio: 'ignore', env: { ...process.env, POST_LOG: postLog } });
const cleanup = () => { server.kill(); fs.rmSync(out, { recursive: true, force: true }); };

let bad = 0;
const check = (ok, msg) => { if (!ok) { console.log(`FAIL  ${msg}`); bad++; } };

try {
  await new Promise(r => setTimeout(r, 1000));
  const run = (script, ...args) => {
    const r = spawnSync(node, [path.join(root, 'scripts', script), ...args], { encoding: 'utf8' });
    if (r.status !== 0) { console.error(r.stdout + r.stderr); throw new Error(`${script} failed`); }
  };
  const url = `http://localhost:${port}`;
  run('crawl.mjs', url, '--out', out, '--max-pages', '12');
  run('analyze-crawl.mjs', path.join(out, 'site-map.json'));
  run('explore.mjs', '--site-map', path.join(out, 'site-map.json'), '--out', out, '--env', 'readonly');

  const cases = JSON.parse(fs.readFileSync(path.join(root, 'evals', 'cases.json'), 'utf8'));
  const read = f => JSON.parse(fs.readFileSync(path.join(out, f), 'utf8'));
  const found = new Map([...read('auto-findings.json'), ...read('explore-findings.json')].map(f => [f.rule, f]));

  for (const rule of [...cases.auto, ...cases.explore]) check(found.has(rule), `missing finding: ${rule}`);
  for (const n of cases.notExpected ?? []) {
    const hit = found.get(n.rule)?.pages.some(p => new URL(p).pathname === n.page);
    check(!hit, `unexpected ${n.rule} on ${n.page} (${n.why})`);
  }
  check(!fs.existsSync(postLog), `read-only exploration sent write requests to the server:\n${fs.existsSync(postLog) ? fs.readFileSync(postLog, 'utf8') : ''}`);
  const summary = read('exploration-log.json').summary;
  check(summary.writesBlocked > 0 && summary.writesAllowed === 0, `read-only summary should show blocked writes and none allowed (blocked ${summary.writesBlocked}, allowed ${summary.writesAllowed})`);

  console.log(bad ? `${bad} check(s) failed` : `OK: ${cases.auto.length} automatic and ${cases.explore.length} exploratory defects found, ${cases.notExpected.length} false-positive traps quiet, ${summary.writesBlocked} write(s) blocked and none sent`);
  process.exitCode = bad ? 1 : 0;
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}
