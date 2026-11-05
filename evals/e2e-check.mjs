#!/usr/bin/env node
// End-to-end check: crawl the demo shop, explore it, scaffold the suite, run it with real Playwright Test,
// build the report and package the results.
// Needs the dependencies and a browser installed (npm run setup). Run: npm run e2e
// The demo has seeded defects, so some generated tests are EXPECTED to fail.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'qa-out-e2e');
const port = '8768';
const url = `http://localhost:${port}`;
const node = process.execPath;
const script = n => path.join(root, 'scripts', n);
const postLog = path.join(root, 'qa-out-e2e-writes.log');

fs.rmSync(out, { recursive: true, force: true });
fs.rmSync(postLog, { force: true });
const server = spawn(node, [path.join(root, 'evals', 'demo-app', 'serve.mjs'), port], { stdio: 'ignore', env: { ...process.env, POST_LOG: postLog } });
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', ...opts });
const exists = (...p) => fs.existsSync(path.join(out, ...p));

try {
  await new Promise(r => setTimeout(r, 1000));

  let r = run(node, [script('check-reachable.mjs'), url]);
  check(r.status === 0, 'demo shop reachable');

  r = run(node, [script('crawl.mjs'), url, '--out', out, '--max-pages', '12']);
  check(r.status === 0 && exists('site-map.json'), 'crawl wrote site-map.json');
  const meta = exists('site-map.json') ? JSON.parse(fs.readFileSync(path.join(out, 'site-map.json'), 'utf8')).meta : {};
  check(meta.axeAvailable === true, 'axe-core scan ran (not skipped)');

  r = run(node, [script('analyze-crawl.mjs'), path.join(out, 'site-map.json')]);
  check(r.status === 0 && exists('auto-findings.json'), 'analyze-crawl ran');

  r = run(node, [script('explore.mjs'), '--site-map', path.join(out, 'site-map.json'), '--out', out, '--env', 'readonly']);
  check(r.status === 0 && exists('exploration-log.json') && exists('exploration-notes.md'), 'read-only exploration ran and wrote its notes');
  check(!fs.existsSync(postLog), 'read-only exploration sent no write request to the server');
  const explored = exists('explore-findings.json') ? JSON.parse(fs.readFileSync(path.join(out, 'explore-findings.json'), 'utf8')) : [];
  check(explored.length >= 5, `exploration found functional defects (${explored.length})`);

  r = run(node, [script('scaffold-suite.mjs'), path.join(out, 'suite'), url, path.join(out, 'site-map.json')]);
  check(r.status === 0 && exists('suite', 'qa.config.json'), 'suite scaffolded from crawl and exploration');
  const cfg = exists('suite', 'qa.config.json') ? JSON.parse(fs.readFileSync(path.join(out, 'suite', 'qa.config.json'), 'utf8')) : { explored: {} };
  check((cfg.explored.forms?.length ?? 0) > 0 && (cfg.explored.searches?.length ?? 0) > 0, 'generated suite includes the explored forms and searches');

  // shell:true so npx resolves on Windows (npx.cmd)
  r = run('npx playwright test -c qa-out-e2e/suite --project=chromium', [], { shell: true });
  const resultsFile = path.join(out, 'suite', 'results', 'results.json');
  check(fs.existsSync(resultsFile), 'Playwright produced results.json');
  if (fs.existsSync(resultsFile)) {
    const stats = JSON.parse(fs.readFileSync(resultsFile, 'utf8')).stats ?? {};
    console.log(`      tests: ${stats.expected ?? 0} passed, ${stats.unexpected ?? 0} failed, ${stats.skipped ?? 0} skipped`);
    check((stats.expected ?? 0) > 0, 'some generated tests passed');
    check((stats.unexpected ?? 0) > 0, 'seeded defects made some generated tests fail (as intended)');
    check(!fs.existsSync(postLog), 'the suite sent no write request either (ALLOW_WRITES is not set)');
  } else {
    console.log((r.stdout ?? '') + (r.stderr ?? ''));
  }

  r = run(node, [script('build-report.mjs'), '--out', out, '--pw-results', resultsFile, '--title', 'e2e']);
  const md = exists('report.md') ? fs.readFileSync(path.join(out, 'report.md'), 'utf8') : '';
  check(r.status === 0 && md.includes('Failed test:'), 'report includes failed suite tests');
  check(md.includes('Source: explore') && md.includes('## What was explored'), 'report includes exploratory findings and a coverage section');

  r = run(node, [script('package-results.mjs'), out, path.join(out, 'suite'), path.join(out, 'pkg')]);
  check(r.status === 0 && fs.readdirSync(path.join(out, 'pkg')).length === 1, 'results packaged');
} catch (e) {
  console.error(e);
  failed++;
} finally {
  server.kill();
  fs.rmSync(postLog, { force: true });
  // KEEP_E2E_OUT=1 leaves the output folder in place (CI uploads it as an artifact)
  if (!process.env.KEEP_E2E_OUT) fs.rmSync(out, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} check(s) failed` : '\nE2E OK');
process.exitCode = failed ? 1 : 0;
