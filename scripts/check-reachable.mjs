#!/usr/bin/env node
// Checks that a URL answers before any testing starts. Works the same on Windows, macOS and Linux.
// Usage: node scripts/check-reachable.mjs <url>      (exit code 0 = reachable)
const url = process.argv[2];
if (!url) { console.error('Usage: node scripts/check-reachable.mjs <url>'); process.exit(1); }

try {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(15000) });
  console.log(`${res.status} ${res.statusText}  ${res.url}`);
  if (res.status === 401 || res.status === 403) console.log('Blocked or login required: do not work around it; ask for credentials or an allowed test environment.');
  process.exit(res.status < 500 ? 0 : 1);
} catch (e) {
  const code = e.cause?.code ?? e.name;
  const hint = {
    ENOTFOUND: 'DNS name does not exist or is not reachable from this network (wrong URL, or needs VPN).',
    ECONNREFUSED: 'Nothing is listening there (site down, or local server not started).',
    TimeoutError: 'No answer within 15 seconds.',
    CERT_HAS_EXPIRED: 'TLS certificate problem.',
  }[code] ?? 'Request failed.';
  console.log(`NOT REACHABLE (${code}): ${hint}`);
  process.exit(1);
}
