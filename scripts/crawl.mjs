#!/usr/bin/env node
// Read-only reconnaissance crawler built on the Playwright library (no MCP, no CLI needed).
// It only issues GET/HEAD requests: it never clicks, types or submits anything.
//
// Usage: node scripts/crawl.mjs <url> [--out qa-out] [--max-pages 15] [--max-depth 3]
//          [--storage-state auth/user.json] [--ignore "regex,regex"] [--no-screenshots]
//          [--no-mobile] [--no-external-links] [--no-probe] [--timeout 20000]
// Env:   BROWSER_CHANNEL=chrome|msedge  use the installed browser instead of Playwright's Chromium
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

// ---------- arguments ----------
const argv = process.argv.slice(2);
const flag = n => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : d; };
const startUrl = argv.find(a => /^https?:\/\//.test(a));
if (!startUrl) { console.error('Usage: node scripts/crawl.mjs <url> [--out dir] [--max-pages N] [--max-depth N]'); process.exit(1); }

const out = path.resolve(opt('out', 'qa-out'));
const maxPages = Number(opt('max-pages', 15));
const maxDepth = Number(opt('max-depth', 3));
const timeout = Number(opt('timeout', 20000));
const storageState = opt('storage-state');
const userIgnore = (opt('ignore', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const ignorePatterns = ['logout', 'log-out', 'signout', 'sign-out', 'delete', 'remove', ...userIgnore].map(s => new RegExp(s, 'i'));
const wantShots = !flag('no-screenshots');
const wantMobile = !flag('no-mobile');
const wantExternal = !flag('no-external-links');
const wantProbe = !flag('no-probe');
const channel = process.env.BROWSER_CHANNEL || undefined;

// axe-core is optional: without it the report says so and falls back to DOM-based checks
let AxeBuilder = null;
try { AxeBuilder = (await import('@axe-core/playwright')).default; }
catch { console.warn('WARNING: @axe-core/playwright not installed - automated WCAG scan SKIPPED. Run `npm run setup`.'); }

const origin = new URL(startUrl).origin;
const norm = u => { const x = new URL(u); x.hash = ''; if (x.pathname.length > 1) x.pathname = x.pathname.replace(/\/+$/, ''); return x.href; };
const slug = u => { const x = new URL(u); return ((x.pathname + x.search).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home').slice(0, 50); };
const skipUrl = u => /\.(pdf|zip|png|jpe?g|gif|svg|webp|mp4|mp3|docx?|xlsx?|pptx?|ico|css|js|json|xml|txt)(\?|$)/i.test(u) || ignorePatterns.some(r => r.test(u));

fs.mkdirSync(path.join(out, 'screenshots'), { recursive: true });

// ---------- code that runs inside the page ----------
const initScript = () => {
  window.__qa = { lcp: 0, cls: 0, longTasks: 0, longTaskMs: 0 };
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__qa.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__qa.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) { window.__qa.longTasks++; window.__qa.longTaskMs += e.duration; } }).observe({ type: 'longtask', buffered: true });
  } catch { /* not supported by this browser */ }
};

const extract = () => {
  const text = el => ((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim();
  const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const labelOf = el => {
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    const by = el.getAttribute('aria-labelledby');
    if (by) return by.split(/\s+/).map(id => text(document.getElementById(id))).join(' ').trim();
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return text(l); }
    const wrap = el.closest('label');
    return wrap ? text(wrap) : '';
  };
  const selectorOf = el => {
    if (el.id) return `#${el.id}`;
    const n = el.getAttribute('name');
    return n ? `${el.tagName.toLowerCase()}[name="${n}"]` : el.tagName.toLowerCase();
  };
  const r = {};
  r.title = document.title;
  r.lang = document.documentElement.lang || '';
  r.metaDescription = document.querySelector('meta[name="description"]')?.content || '';
  r.canonical = document.querySelector('link[rel="canonical"]')?.href || '';
  r.viewportMeta = document.querySelector('meta[name="viewport"]')?.content || '';
  r.robotsMeta = document.querySelector('meta[name="robots"]')?.content || '';
  r.ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
  r.h1 = [...document.querySelectorAll('h1')].map(text);
  r.headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].slice(0, 60).map(h => ({ level: Number(h.tagName[1]), text: text(h).slice(0, 100) }));
  r.landmarks = { main: document.querySelectorAll('main,[role=main]').length, nav: document.querySelectorAll('nav,[role=navigation]').length };
  r.hasSkipLink = [...document.querySelectorAll('a[href^="#"]')].slice(0, 4).some(a => /skip/i.test(text(a) + a.className + a.id));
  r.nav = [...document.querySelectorAll('nav a')].slice(0, 40).map(a => ({ text: text(a), href: a.href }));
  r.links = [...document.querySelectorAll('a[href]')].slice(0, 400).map(a => ({
    href: a.href, raw: a.getAttribute('href'), text: text(a).slice(0, 80) || a.getAttribute('aria-label') || a.querySelector('img')?.alt || '', target: a.target, rel: a.rel,
  }));
  r.buttons = [...document.querySelectorAll('button,[role=button],input[type=submit],input[type=button]')].slice(0, 60)
    .map(b => ({ text: text(b) || b.value || b.getAttribute('aria-label') || '', type: b.type || '', disabled: !!b.disabled, inForm: !!b.closest('form') }));
  r.forms = [...document.forms].map((f, index) => ({
    index, id: f.id, action: f.action, method: (f.method || 'get').toLowerCase(), novalidate: f.noValidate, selector: selectorOf(f),
    fields: [...f.elements].filter(e => (e.name || e.id) && !['fieldset', 'object', 'output'].includes(e.tagName.toLowerCase())).map(e => ({
      tag: e.tagName.toLowerCase(), type: e.type || '', name: e.name, id: e.id, label: labelOf(e), placeholder: e.placeholder || '',
      required: !!e.required, autocomplete: e.autocomplete || '', pattern: e.pattern || '', min: e.min || '', max: e.max || '',
      maxlength: e.maxLength > 0 ? e.maxLength : '', visible: visible(e), selector: selectorOf(e),
    })),
    submit: [...f.querySelectorAll('button,input[type=submit]')].map(b => text(b) || b.value),
    hasCsrfLikeField: !!f.querySelector('input[name*="csrf" i],input[name*="token" i],input[name="_token"],input[name="authenticity_token"]'),
  }));
  r.inputsOutsideForms = [...document.querySelectorAll('input,select,textarea')].filter(e => !e.form && e.type !== 'hidden').length;
  r.images = [...document.images].slice(0, 200).map(i => ({
    src: i.currentSrc || i.src, alt: i.getAttribute('alt'), broken: i.complete && i.naturalWidth === 0,
    decorative: i.getAttribute('alt') === '' || i.getAttribute('role') === 'presentation',
  }));
  r.externalScripts = [...document.scripts].filter(s => s.src).map(s => ({ src: s.src, integrity: s.integrity || '' }));
  r.duplicateIds = (() => { const c = {}; document.querySelectorAll('[id]').forEach(e => { c[e.id] = (c[e.id] || 0) + 1; }); return Object.keys(c).filter(k => c[k] > 1).slice(0, 20); })();
  r.positiveTabindex = document.querySelectorAll('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])').length;
  r.emptyLinks = [...document.querySelectorAll('a[href]')].filter(a => !text(a) && !a.getAttribute('aria-label') && !a.querySelector('img[alt]:not([alt=""])')).length;
  r.placeholderLinks = [...document.querySelectorAll('a[href]')].filter(a => ['#', ''].includes(a.getAttribute('href')) || /^javascript:/i.test(a.getAttribute('href'))).length;
  r.blankTargetNoRel = [...document.querySelectorAll('a[target="_blank"]')].filter(a => !/noopener|noreferrer/i.test(a.rel)).length;
  r.passwordFields = document.querySelectorAll('input[type=password]').length;
  r.textSample = text(document.body).slice(0, 700);
  r.wordCount = text(document.body).split(' ').filter(Boolean).length;
  r.mixedContentRefs = [...document.querySelectorAll('[src],[href]')].map(e => e.getAttribute('src') || e.getAttribute('href')).filter(u => u && /^http:\/\//i.test(u)).slice(0, 20);
  r.localStorageKeys = (() => { try { return Object.keys(localStorage).slice(0, 20); } catch { return []; } })();
  return r;
};

const layoutCheck = deviceWidth => {
  const wide = [...document.querySelectorAll('body *')]
    .filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > deviceWidth + 1 && getComputedStyle(e).position !== 'fixed'; })
    .slice(0, 5).map(e => e.tagName.toLowerCase() + (e.id ? `#${e.id}` : ''));
  const tiny = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=button]')]
    .filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && (b.width < 24 || b.height < 24); }).length;
  const smallText = [...document.querySelectorAll('p,li,span,a,label,td')]
    .filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 12).length;
  return { scrollWidth: document.documentElement.scrollWidth, deviceWidth, horizontalOverflow: document.documentElement.scrollWidth > deviceWidth + 1, overflowing: wide, smallTapTargets: tiny, tinyTextElements: smallText };
};

const focusCheck = () => {
  const vis = e => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const all = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[tabindex="0"]')].filter(vis);
  const picked = [...all.filter(e => e.tagName === 'A').slice(0, 3), ...all.filter(e => e.tagName !== 'A').slice(0, 12)];
  const res = picked.map(e => {
    e.focus(); const s = getComputedStyle(e);
    return { tag: e.tagName.toLowerCase(), text: (e.innerText || e.value || e.getAttribute('aria-label') || e.name || '').slice(0, 30), indicator: (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none' };
  });
  if (document.activeElement) document.activeElement.blur();
  window.scrollTo(0, 0);
  return { tabStops: res.length, focusVisibleOnAll: res.every(x => x.indicator), offenders: res.filter(x => !x.indicator).slice(0, 5) };
};

// ---------- waiting for a page to settle ----------
// A user sees a page after it has loaded, fonts and styles are applied and late content has arrived.
// Measuring earlier produces false "broken layout" findings, so wait until the page stops changing.
async function quiet(page, quietMs, maxMs, minMs) {
  await page.evaluate(({ quietMs, maxMs, minMs }) => new Promise(done => {
    const sig = () => [document.documentElement.scrollHeight, document.styleSheets.length, document.body ? document.body.innerText.length : 0,
      [...document.images].filter(i => !i.complete).length, document.querySelectorAll('*').length].join('|');
    let last = sig(), since = Date.now(); const start = Date.now();
    const t = setInterval(() => {
      const now = sig(); if (now !== last) { last = now; since = Date.now(); }
      const age = Date.now() - start;
      if (age >= maxMs || (age >= minMs && Date.now() - since >= quietMs)) { clearInterval(t); done(); }
    }, 150);
  }), { quietMs, maxMs, minMs }).catch(() => {});
}
async function settle(page, minMs = 3000) {
  await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await quiet(page, 1000, 9000, minMs);
}
async function scrollThrough(page) { // loads lazy images/sections, then returns to the top
  await page.evaluate(async () => {
    const step = Math.max(300, innerHeight * 0.8);
    for (let y = 0; y < Math.min(document.documentElement.scrollHeight, 20000); y += step) { scrollTo(0, y); await new Promise(r => setTimeout(r, 100)); }
    scrollTo(0, 0);
  }).catch(() => {});
  await quiet(page, 600, 4000, 0);
}

// ---------- crawl ----------
const browser = await chromium.launch({ channel });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, ...(storageState ? { storageState } : {}) });
await ctx.addInitScript(initScript);

const pages = [];
const seen = new Set([norm(startUrl)]);
const queue = [{ url: norm(startUrl), depth: 0, from: null }];
const allLinks = new Map();

async function crawlOne({ url, depth, from }, n) {
  const page = await ctx.newPage();
  const rec = { url, depth, discoveredFrom: from, consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], mixedContent: [] };
  page.on('console', m => { if (m.type() === 'error') rec.consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => rec.pageErrors.push(String(e.message || e).slice(0, 300)));
  page.on('requestfailed', r => rec.failedRequests.push({ url: r.url().slice(0, 200), error: r.failure()?.errorText }));
  page.on('response', r => {
    if (r.status() >= 400 && r.url() !== url) rec.badResponses.push({ url: r.url().slice(0, 200), status: r.status(), type: r.request().resourceType() });
    if (url.startsWith('https:') && r.url().startsWith('http:')) rec.mixedContent.push(r.url().slice(0, 200));
  });
  const t0 = Date.now();
  try {
    const resp = await page.goto(url, { waitUntil: 'load', timeout });
    await settle(page);
    rec.status = resp?.status() ?? null;
    rec.finalUrl = page.url();
    rec.headers = resp ? await resp.allHeaders() : {};
    rec.loadMs = Date.now() - t0;
    if (new URL(page.url()).origin !== origin) { rec.leftOrigin = true; return; }
    rec.perf = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const res = performance.getEntriesByType('resource');
      return {
        ttfbMs: Math.round(nav.responseStart || 0), loadEventMs: Math.round(nav.loadEventEnd || 0), lcpMs: Math.round(window.__qa?.lcp || 0),
        cls: +(window.__qa?.cls || 0).toFixed(3), longTasks: window.__qa?.longTasks || 0, longTaskMs: Math.round(window.__qa?.longTaskMs || 0),
        requests: res.length, transferKB: Math.round(res.reduce((a, r) => a + (r.transferSize || 0), 0) / 1024),
      };
    });
    await scrollThrough(page); // after the perf read, so our own scrolling cannot inflate layout shift
    Object.assign(rec, await page.evaluate(extract));
    if (AxeBuilder) {
      try {
        const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
        rec.a11y = { violations: res.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, tags: v.tags.filter(t => /^wcag\d|^best/.test(t)), count: v.nodes.length, nodes: v.nodes.slice(0, 3).map(x => ({ target: x.target.join(' '), html: x.html.slice(0, 160) })) })) };
      } catch (e) { rec.a11yError = String(e.message).slice(0, 200); }
    } else rec.axeSkipped = true;
    rec.cookiesSeen = (await ctx.cookies(url)).map(c => ({ name: c.name, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite }));
    await page.keyboard.press('Tab'); // switch to keyboard modality so :focus-visible styles apply
    rec.keyboard = await page.evaluate(focusCheck);
    if (wantShots) {
      rec.screenshot = `screenshots/${String(n).padStart(2, '0')}-${slug(url)}-desktop.png`;
      await page.screenshot({ path: path.join(out, rec.screenshot), fullPage: true }).catch(() => { rec.screenshot = null; });
    }
    for (const l of rec.links || []) {
      let u; try { u = new URL(l.href); } catch { continue; }
      if (!/^https?:$/.test(u.protocol)) continue;
      const key = norm(u.href);
      if (!allLinks.has(key)) allLinks.set(key, { href: key, internal: u.origin === origin, foundOn: [] });
      if (allLinks.get(key).foundOn.length < 3) allLinks.get(key).foundOn.push(url);
      if (u.origin === origin && !seen.has(key) && depth < maxDepth && !skipUrl(key)) { seen.add(key); queue.push({ url: key, depth: depth + 1, from: url }); }
    }
  } catch (e) {
    rec.error = String(e.message).split('\n')[0].slice(0, 200);
  } finally {
    pages.push(rec);
    console.log(`[${pages.length}/${maxPages}] ${rec.status ?? 'ERR'} ${url}${rec.error ? '  ' + rec.error : ''}`);
    await page.close();
  }
}

let counter = 0;
while (queue.length && pages.length < maxPages) {
  const batch = queue.splice(0, Math.min(3, maxPages - pages.length));
  await Promise.all(batch.map(item => crawlOne(item, ++counter)));
}

// ---------- mobile pass ----------
if (wantMobile) {
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...(storageState ? { storageState } : {}) });
  const targets = pages.filter(p => p.status && !p.error && !p.leftOrigin);
  for (let k = 0; k < targets.length; k += 3) {
    await Promise.all(targets.slice(k, k + 3).map(async (rec, j) => {
      const p = await mctx.newPage();
      try {
        await p.goto(rec.url, { waitUntil: 'load', timeout });
        await settle(p, 2500); await scrollThrough(p);
        rec.mobile = await p.evaluate(layoutCheck, 390);
        if (wantShots) {
          rec.screenshotMobile = `screenshots/${String(k + j + 1).padStart(2, '0')}-${slug(rec.url)}-mobile.png`;
          await p.screenshot({ path: path.join(out, rec.screenshotMobile), fullPage: true }).catch(() => { rec.screenshotMobile = null; });
        }
      } catch (e) { rec.mobile = { error: String(e.message).split('\n')[0] }; }
      await p.close();
    }));
  }
  await mctx.close();
}

// ---------- site-level checks and link validation ----------
const api = ctx.request;
const site = {};
for (const [k, p] of Object.entries({ robots: '/robots.txt', sitemap: '/sitemap.xml', securityTxt: '/.well-known/security.txt', favicon: '/favicon.ico' })) {
  try { const r = await api.get(origin + p, { timeout: 8000, maxRedirects: 3 }); site[k] = { status: r.status(), contentType: r.headers()['content-type'] || '' }; }
  catch { site[k] = { error: 'unreachable' }; }
}
try { const r = await api.get(`${origin}/qa-nonexistent-${Date.now()}`, { timeout: 8000, maxRedirects: 0 }); site.notFound = { status: r.status(), body: (await r.text()).replace(/\s+/g, ' ').slice(0, 200) }; }
catch { site.notFound = { error: 'unreachable' }; }

const toCheck = [...allLinks.values()].filter(l => l.internal || wantExternal).slice(0, 120);
const links = []; let cursor = 0;
await Promise.all([0, 1, 2, 3].map(async () => {
  while (cursor < toCheck.length) {
    const l = toCheck[cursor++];
    try {
      let r = await api.fetch(l.href, { method: 'HEAD', timeout: 8000, maxRedirects: 5 });
      if ([403, 405, 501].includes(r.status())) r = await api.get(l.href, { timeout: 8000, maxRedirects: 5 });
      links.push({ ...l, status: r.status() });
    } catch (e) { links.push({ ...l, status: 0, error: String(e.message).split('\n')[0].slice(0, 100) }); }
  }
}));

// ---------- passive reflection probe: GET only, one inert marker ----------
const probes = [];
if (wantProbe) {
  const marker = 'qa9probe"><i>z</i>';
  const targets = new Map();
  for (const p of pages) {
    try { const u = new URL(p.url); const keys = [...u.searchParams.keys()]; if (keys.length) targets.set(u.pathname + '|' + keys.sort(), { url: u, params: keys }); } catch { /* ignore */ }
    for (const f of p.forms || []) {
      if (f.method !== 'get') continue;
      const names = f.fields.filter(x => ['text', 'search', 'email', 'url', ''].includes(x.type) && x.name).map(x => x.name);
      try { const u = new URL(f.action || p.url, p.url); if (names.length && u.origin === origin) targets.set(u.pathname + '|' + names.sort(), { url: u, params: names }); } catch { /* ignore */ }
    }
  }
  for (const { url: u, params } of [...targets.values()].slice(0, 15)) {
    for (const prm of params.slice(0, 3)) {
      const t = new URL(u.href); t.searchParams.set(prm, marker);
      try {
        const r = await api.get(t.href, { timeout: 8000 });
        probes.push({ url: u.origin + u.pathname, param: prm, status: r.status(), reflectedRaw: (await r.text()).includes(marker), contentType: r.headers()['content-type'] || '' });
      } catch { /* ignore */ }
    }
  }
}

await browser.close();
const result = {
  meta: { startUrl, origin, crawledAt: new Date().toISOString(), pagesVisited: pages.length, maxPages, maxDepth, axeAvailable: !!AxeBuilder, authenticated: !!storageState, queueRemaining: queue.length, channel: channel || 'chromium' },
  pages, site, links, probes,
};
fs.writeFileSync(path.join(out, 'site-map.json'), JSON.stringify(result, null, 2));
console.log(`Done. ${pages.length} page(s), ${links.length} link(s) checked -> ${path.join(out, 'site-map.json')}` + (queue.length ? ` (${queue.length} more page(s) queued: raise --max-pages)` : ''));
