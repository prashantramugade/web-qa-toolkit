#!/usr/bin/env node
// Read-only crawler. Uses the Playwright *library* directly (no MCP, no CLI needed).
// Usage: node scripts/crawl.mjs <url> [--out qa-out] [--max-pages 15] [--storage-state auth.json] [--ignore "logout,signout"]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const startUrl = args[0];
if (!startUrl) { console.error('Usage: node scripts/crawl.mjs <url> [--out dir] [--max-pages N]'); process.exit(1); }
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : d; };
const out = opt('out', 'qa-out');
const maxPages = Number(opt('max-pages', 15));
const storageState = opt('storage-state');
const ignore = opt('ignore', 'logout,signout,sign-out,delete,remove').split(',').map(s => s.trim()).filter(Boolean);

// axe-core is optional: if the package can't be loaded, say so loudly and record it so the report lists a11y as not covered.
let AxeBuilder = null;
try { AxeBuilder = (await import('@axe-core/playwright')).default; }
catch { console.warn('WARNING: @axe-core/playwright not installed - accessibility scan SKIPPED. Run `npm run setup`.'); }

fs.mkdirSync(path.join(out, 'evidence'), { recursive: true });
const origin = new URL(startUrl).origin;
const norm = u => { const x = new URL(u, origin); x.hash = ''; return x.href.replace(/\/$/, ''); };
const slug = u => (new URL(u).pathname.replace(/\W+/g, '_').replace(/^_|_$/g, '') || 'home').slice(0, 60);

// Default: Playwright's own Chromium. Set BROWSER_CHANNEL=chrome (or msedge) to use the browser installed on this machine instead.
const channel = process.env.BROWSER_CHANNEL || undefined;
const browser = await chromium.launch({ channel });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  ...(storageState ? { storageState } : {}),
});

const queue = [norm(startUrl)];
const seen = new Set(queue);
const pages = [];
const externalLinks = new Set();

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(800);
}

while (queue.length && pages.length < maxPages) {
  const url = queue.shift();
  const page = await ctx.newPage();
  const consoleErrors = [], failedRequests = [], mixed = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on('requestfailed', r => failedRequests.push(`${r.method()} ${r.url()} - ${r.failure()?.errorText}`));
  page.on('response', r => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });
  page.on('request', r => { if (url.startsWith('https:') && r.url().startsWith('http:')) mixed.push(r.url()); });

  const rec = { url, status: null, headers: {}, consoleErrors, failedRequests, mixed };
  try {
    const t0 = Date.now();
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    rec.status = resp?.status() ?? null;
    rec.headers = resp ? await resp.allHeaders() : {};
    await settle(page);
    rec.loadMs = Date.now() - t0;

    // Read-only DOM facts
    rec.dom = await page.evaluate(() => {
      const q = s => [...document.querySelectorAll(s)];
      return {
        title: document.title,
        lang: document.documentElement.lang,
        metaDescription: document.querySelector('meta[name=description]')?.content ?? null,
        viewportMeta: !!document.querySelector('meta[name=viewport]'),
        canonical: document.querySelector('link[rel=canonical]')?.href ?? null,
        h1Count: q('h1').length,
        imagesNoAlt: q('img:not([alt])').length,
        inputsNoLabel: q('input:not([type=hidden]):not([type=submit]):not([type=button])')
          .filter(i => !i.labels?.length && !i.getAttribute('aria-label') && !i.getAttribute('aria-labelledby')).length,
        buttonsNoName: q('button').filter(b => !b.textContent.trim() && !b.getAttribute('aria-label')).length,
        horizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        forms: q('form').length,
        cookies: document.cookie ? document.cookie.split(';').length : 0,
      };
    });

    // Mobile overflow check on settled page
    await page.setViewportSize({ width: 390, height: 800 });
    await page.waitForTimeout(300);
    rec.mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    await page.setViewportSize({ width: 1280, height: 800 });

    // Accessibility (axe-core, WCAG A/AA)
    if (AxeBuilder) {
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      rec.axe = axe.violations.map(v => ({
        id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.length,
        sample: v.nodes[0]?.target?.join(' ') ?? '',
      }));
    } else rec.axeSkipped = true;

    const shot = path.join(out, 'evidence', `${slug(url)}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    rec.screenshot = shot;

    // Links (GET navigation only; never click or submit)
    const links = await page.$$eval('a[href]', as => as.map(a => a.href));
    for (const l of links) {
      if (!/^https?:/.test(l)) continue;
      const n = norm(l);
      if (new URL(n).origin !== origin) { externalLinks.add(n); continue; }
      if (ignore.some(w => n.toLowerCase().includes(w))) continue;
      if (/\.(pdf|zip|png|jpe?g|gif|svg|webp|mp4|css|js)$/i.test(n)) continue;
      if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
  } catch (e) {
    rec.error = String(e).slice(0, 300);
  }
  pages.push(rec);
  await page.close();
  console.log(`[${pages.length}/${maxPages}] ${rec.status ?? 'ERR'} ${url}`);
}

// Check internal links that were discovered but not crawled (HEAD only), plus up to 20 external
const unvisited = queue.slice(0, 40);
const linkChecks = [];
for (const u of [...unvisited, ...[...externalLinks].slice(0, 20)]) {
  try {
    const r = await ctx.request.head(u, { timeout: 10000, failOnStatusCode: false });
    linkChecks.push({ url: u, status: r.status() });
  } catch (e) { linkChecks.push({ url: u, status: 0, error: String(e).slice(0, 120) }); }
}

await browser.close();
fs.writeFileSync(path.join(out, 'site-map.json'), JSON.stringify({ startUrl, crawledAt: new Date().toISOString(), pages, linkChecks }, null, 2));
console.log(`Done. ${pages.length} pages -> ${path.join(out, 'site-map.json')}`);
