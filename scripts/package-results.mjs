#!/usr/bin/env node
// Bundles the report, evidence and suite (without node_modules or run results) into one archive.
// Usage: node scripts/package-results.mjs <out-dir> <suite-dir> <dest-dir>
// Uses the `tar` that ships with Windows 10+, macOS and Linux. Windows/macOS get a .zip, Linux a .tar.gz.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [outDir, suiteDir, destDir] = process.argv.slice(2);
if (!outDir || !destDir) {
  console.error('Usage: node scripts/package-results.mjs <out-dir> <suite-dir> <dest-dir>');
  process.exit(1);
}

const skip = new Set(['node_modules', 'results', 'test-results', 'suite']);
const copyFilter = src => !skip.has(path.basename(src));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-pack-'));
let keepTmp = false;
try {
  fs.cpSync(outDir, path.join(tmp, 'qa-out'), { recursive: true, filter: copyFilter });
  if (suiteDir && fs.existsSync(suiteDir)) {
    fs.cpSync(suiteDir, path.join(tmp, 'suite'), {
      recursive: true,
      filter: src => !['node_modules', 'results', 'test-results'].includes(path.basename(src)),
    });
  }

  fs.mkdirSync(destDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const useZip = process.platform !== 'linux';
  const archive = path.resolve(destDir, `qa-results-${stamp}.${useZip ? 'zip' : 'tar.gz'}`);
  const args = useZip ? ['-a', '-c', '-f', archive, '-C', tmp, '.'] : ['-czf', archive, '-C', tmp, '.'];

  const r = spawnSync('tar', args, { stdio: 'inherit' });
  if (r.status !== 0) { keepTmp = true; console.error('Could not create the archive (is `tar` available?). The files are in ' + tmp); process.exitCode = 1; } else
  console.log(`Packaged: ${archive}`);
} finally {
  if (!keepTmp) fs.rmSync(tmp, { recursive: true, force: true });
}
