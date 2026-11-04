#!/usr/bin/env node
// End-to-end check: crawl the demo app, scaffold the suite, run it with real Playwright Test, build the report.
// Needs the dependencies and a browser installed (npm run setup). Run: npm run e2e
// The demo app has seeded defects, so some generated tests are EXPECTED to fail.
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

const server = spawn(node, [path.join(root, 'evals', 'demo-app', 'serve.mjs'), port], { stdio: 'ignore' });
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', ...opts });

try {
  fs.rmSync(out, { recursive: true, force: true });
  await new Promise(r => setTimeout(r, 1000));

  let r = run(node, [script('check-reachable.mjs'), url]);
  check(r.status === 0, 'demo app reachable');

  r = run(node, [script('crawl.mjs'), url, '--out', out, '--max-pages', '5']);
  check(r.status === 0 && fs.existsSync(path.join(out, 'site-map.json')), 'crawl wrote site-map.json');
  check(!/axe-core scan SKIPPED|accessibility scan SKIPPED/.test(r.stdout + r.stderr), 'axe-core scan ran (not skipped)');

  r = run(node, [script('analyze-crawl.mjs'), path.join(out, 'site-map.json')]);
  check(r.status === 0, 'analyze-crawl ran');

  r = run(node, [script('scaffold-suite.mjs'), path.join(out, 'suite'), url, path.join(out, 'site-map.json')]);
  check(r.status === 0 && fs.existsSync(path.join(out, 'suite', 'qa.config.json')), 'suite scaffolded');

  // shell:true so npx resolves on Windows (npx.cmd)
  r = run('npx playwright test -c qa-out-e2e/suite --project=chromium', [], { shell: true });
  const resultsFile = path.join(out, 'suite', 'results', 'results.json');
  check(fs.existsSync(resultsFile), 'Playwright produced results.json');
  if (fs.existsSync(resultsFile)) {
    const stats = JSON.parse(fs.readFileSync(resultsFile, 'utf8')).stats ?? {};
    console.log(`      tests: ${stats.expected ?? 0} passed, ${stats.unexpected ?? 0} failed, ${stats.skipped ?? 0} skipped`);
    check((stats.expected ?? 0) > 0, 'some generated tests passed');
    check((stats.unexpected ?? 0) > 0, 'seeded defects made some generated tests fail (as intended)');
  } else {
    console.log((r.stdout ?? '') + (r.stderr ?? ''));
  }

  r = run(node, [script('build-report.mjs'), '--out', out, '--pw-results', resultsFile, '--title', 'e2e']);
  const md = fs.existsSync(path.join(out, 'report.md')) ? fs.readFileSync(path.join(out, 'report.md'), 'utf8') : '';
  check(r.status === 0 && md.includes('Failed test:'), 'report includes failed suite tests');

  r = run(node, [script('package-results.mjs'), out, path.join(out, 'suite'), path.join(out, 'pkg')]);
  check(r.status === 0 && fs.readdirSync(path.join(out, 'pkg')).length === 1, 'results packaged');
} catch (e) {
  console.error(e);
  failed++;
} finally {
  server.kill();
  fs.rmSync(out, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} check(s) failed` : '\nE2E OK');
process.exitCode = failed ? 1 : 0;
