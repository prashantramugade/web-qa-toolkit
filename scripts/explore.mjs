#!/usr/bin/env node
// Exploratory pass: drives the app the way a tester would and records what it observes.
// Run after the crawl. It probes forms (equivalence classes + boundaries), search, buttons,
// keyboard use and navigation, then writes notes for the agent to judge plus automatic anomalies.
//
// Usage: node scripts/explore.mjs --site-map qa-out/site-map.json [--out qa-out] [--env readonly|staging]
//          [--max-pages 8] [--max-forms 3] [--max-controls 8] [--storage-state auth/user.json] [--timeout 20000]
//
// --env readonly (default): production-safe. Every write request (POST/PUT/PATCH/DELETE) is blocked
//   in the browser before it leaves the machine, so nothing can be created, sent or changed.
// --env staging: submissions are allowed with obviously fake data (QA Tester, qa+probe@example.com).
// In both modes: forms with password fields are never filled, and buttons/forms that look destructive
// (delete, logout, pay, checkout, ...) are never used.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : d; };
const siteMapFile = opt('site-map');
if (!siteMapFile) { console.error('Usage: node scripts/explore.mjs --site-map <out>/site-map.json [--env readonly|staging]'); process.exit(1); }
const out = path.resolve(opt('out', path.dirname(siteMapFile)));
const env = opt('env', 'readonly');
if (!['readonly', 'staging'].includes(env)) { console.error('--env must be readonly or staging'); process.exit(1); }
const maxPages = Number(opt('max-pages', 8));
const maxForms = Number(opt('max-forms', 3));
const maxControls = Number(opt('max-controls', 8));
const timeout = Number(opt('timeout', 20000));
const storageState = opt('storage-state');
const channel = process.env.BROWSER_CHANNEL || undefined;

const map = JSON.parse(fs.readFileSync(siteMapFile, 'utf8'));
const origin = map.meta.origin;
fs.mkdirSync(path.join(out, 'screenshots'), { recursive: true });

// ---------- safety rules ----------
const DESTRUCTIVE = /delete|remove|log ?out|sign ?out|\bpay\b|payment|purchase|\bbuy\b|place order|checkout|confirm|deactivate|close account|transfer|unsubscribe|cancel/i;
const isWrite = m => !['GET', 'HEAD', 'OPTIONS'].includes(m);
let blockWrites = env === 'readonly';
let forceBlock = false; // switched on while exercising forms that must never really submit (e.g. login)
let blockedWrites = 0, allowedWrites = 0;

// ---------- what feedback looks like ----------
const SUCCESS = /thank|success|\bsent\b|received|submitted|saved|subscribed|we will (reply|contact|get back)|message has been/i;
const ERROR = /error|invalid|required|please (enter|provide|fill|select|check)|\bmust\b|cannot|can't|too (short|long)|not valid|incorrect|missing/i;
const EMPTY_STATE = /no (results|products|items|matches|records)|nothing (found|matched)|0 results|did(n't| not) find|not found|no .* found/i;
// errors caused by the toolkit blocking writes (the page's own fetch fails) must not be reported as app defects
const BLOCKED_ERR = /failed to fetch|networkerror|load failed|network request failed|err_failed|aborted/i;
const STACK = /traceback|stack trace|at .+\(.+:\d+:\d+\)|sqlstate|exception in|syntax error near|undefined index/i;

// ---------- findings ----------
const found = new Map();
let shots = 0;
function flag(rule, summary, category, severity, o = {}) {
  let f = found.get(rule);
  if (!f) { f = { rule, summary, category, severity, pages: [], actual: o.actual ?? '', expected: o.expected ?? '', fix: o.fix ?? '', standards: o.standards ?? [], details: [], confidence: o.confidence ?? 'verify', evidence: [], steps: o.steps ?? '', source: 'explore' }; found.set(rule, f); }
  if (o.page && !f.pages.includes(o.page)) f.pages.push(o.page);
  if (o.detail && !f.details.includes(o.detail) && f.details.length < 8) f.details.push(o.detail);
  if (o.evidence && !f.evidence.includes(o.evidence)) f.evidence.push(o.evidence);
}
async function evidence(page, label) {
  if (shots >= 25) return undefined;
  const file = `screenshots/explore-${String(++shots).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.png`;
  await page.screenshot({ path: path.join(out, file), fullPage: false }).catch(() => {});
  return file;
}

// ---------- code that runs inside the page ----------
const readForms = () => {
  const vis = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const text = e => ((e && (e.innerText || e.textContent)) || '').replace(/\s+/g, ' ').trim();
  const labelOf = e => {
    if (e.getAttribute('aria-label')) return e.getAttribute('aria-label');
    if (e.id) { const l = document.querySelector(`label[for="${CSS.escape(e.id)}"]`); if (l) return text(l); }
    const w = e.closest('label'); return w ? text(w) : '';
  };
  return [...document.forms].map((f, i) => {
    const fields = [];
    [...f.elements].forEach((e, j) => {
      const tag = e.tagName.toLowerCase();
      if (!['input', 'select', 'textarea'].includes(tag)) return;
      const type = (e.type || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(type) || !vis(e) || e.disabled) return;
      e.setAttribute('data-qa-f', `${i}-${j}`);
      fields.push({ key: `${i}-${j}`, tag, type, name: e.name, id: e.id, label: labelOf(e), placeholder: e.placeholder || '', required: e.required, min: e.min || '', max: e.max || '', maxlength: e.maxLength > 0 ? e.maxLength : 0, options: tag === 'select' ? e.options.length : 0 });
    });
    const submit = [...f.querySelectorAll('button,input[type=submit]')].filter(b => !['button', 'reset'].includes(b.type)).map(b => (b.innerText || b.value || '').trim());
    return { index: i, method: (f.method || 'get').toLowerCase(), action: f.action, submitText: submit[0] || '', hasPassword: fields.some(x => x.type === 'password'), fields };
  });
};

const snapshot = () => {
  const vis = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const txt = e => (e.innerText || '').replace(/\s+/g, ' ').trim();
  const sel = '[role=status],[role=alert],[aria-live],[class*=error i],[class*=success i],[class*=invalid i],[class*=alert i],[class*=message i],[class*=notice i],[class*=feedback i]';
  const live = [...document.querySelectorAll(sel)].filter(vis).map(e => ({ text: txt(e).slice(0, 160), announced: !!e.closest('[role=status],[role=alert],[aria-live]') })).filter(x => x.text);
  const invalid = [...document.querySelectorAll('input,select,textarea')].filter(e => e.willValidate && !e.validity.valid).map(e => ({ name: e.name || e.id, message: e.validationMessage }));
  const lines = (document.body.innerText || '').split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return { url: location.href, live, invalid, ariaInvalid: document.querySelectorAll('[aria-invalid=true]').length, lines: lines.slice(0, 400) };
};

const readControls = () => {
  const vis = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const els = [...document.querySelectorAll('button,[role=button],input[type=button]')].filter(e => vis(e) && !e.disabled && !(e.closest('form') && e.type !== 'button'));
  return els.slice(0, 40).map((e, i) => {
    e.setAttribute('data-qa-c', i);
    let qty = null;
    for (let a = e.parentElement, k = 0; a && k < 4; a = a.parentElement, k++) {
      const n = a.querySelectorAll('input[type=number]');
      if (n.length === 1) { qty = n[0]; break; }
      if (n.length > 1) break;
    }
    if (qty) qty.setAttribute('data-qa-q', i);
    return { key: i, text: (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().slice(0, 40), qty: qty ? qty.value : null };
  });
};

const mouseOnlyControls = () => {
  const vis = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const native = ['a', 'button', 'input', 'select', 'textarea', 'summary', 'label', 'option'];
  return [...document.querySelectorAll('body *')].filter(e => {
    const tag = e.tagName.toLowerCase();
    if (!vis(e) || native.includes(tag) || e.hasAttribute('tabindex') || ['button', 'link', 'menuitem', 'tab', 'checkbox', 'switch'].includes(e.getAttribute('role'))) return false;
    if (e.closest('a,button,[tabindex],[role=button],[role=link]')) return false;
    const own = getComputedStyle(e).cursor === 'pointer';
    const parent = e.parentElement && getComputedStyle(e.parentElement).cursor === 'pointer';
    return e.hasAttribute('onclick') || (own && !parent && ['div', 'span', 'li', 'img', 'p'].includes(tag));
  }).slice(0, 6).map(e => ({ tag: e.tagName.toLowerCase(), text: (e.innerText || '').trim().slice(0, 40), html: e.outerHTML.slice(0, 120) }));
};

// ---------- helpers ----------
const browser = await chromium.launch({ channel });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, ...(storageState ? { storageState } : {}) });
await ctx.route('**/*', route => {
  const req = route.request();
  if (isWrite(req.method()) && (blockWrites || forceBlock)) {
    blockedWrites++;
    // a form navigation answered with 204 leaves the page where it is; scripted requests simply fail
    return req.resourceType() === 'document' ? route.fulfill({ status: 204, body: '' }) : route.abort('failed');
  }
  if (isWrite(req.method())) allowedWrites++;
  return route.continue();
});

async function openFresh(url) {
  const page = await ctx.newPage();
  const st = { writes: [], writeResponses: [], consoleErrors: [], pageErrors: [], serverErrors: [], dialogs: [] };
  page.on('request', r => { if (isWrite(r.method())) st.writes.push({ method: r.method(), url: r.url() }); });
  page.on('response', r => {
    if (isWrite(r.request().method())) st.writeResponses.push({ url: r.url(), status: r.status() });
    if (r.status() >= 500) st.serverErrors.push(`${r.status()} ${r.url()}`);
  });
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text()) && !(BLOCKED_ERR.test(m.text()) && (blockWrites || forceBlock))) st.consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => { const t = String(e.message || e); if (!(BLOCKED_ERR.test(t) && (blockWrites || forceBlock))) st.pageErrors.push(t.slice(0, 200)); });
  page.on('dialog', d => { st.dialogs.push(d.message().slice(0, 100)); d.dismiss().catch(() => {}); });
  page.on('popup', p => p.close().catch(() => {}));
  await page.goto(url, { waitUntil: 'load', timeout });
  await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(250);
  return { page, st };
}
const settleAfter = async page => { await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {}); await page.waitForTimeout(350); };
const diff = (a, b) => {
  const A = new Set(a.lines), B = new Set(b.lines);
  return { added: b.lines.filter(l => !A.has(l)).slice(0, 8), removed: a.lines.filter(l => !B.has(l)).slice(0, 8), newLive: b.live.filter(x => !a.live.some(y => y.text === x.text)) };
};
// the number that belongs to a counter label such as "Cart: 3" or "3 items", not just any number on the line
const cartNumber = s => { const m = /(?:cart|basket|bag|items?|qty|quantity|count)\D{0,12}(-?\d+(?:\.\d+)?)/i.exec(s || '') || /(-?\d+(?:\.\d+)?)\s*(?:items?|in (?:your )?cart)/i.exec(s || ''); return m ? Number(m[1]) : null; };

function validValue(f) {
  const hint = `${f.name} ${f.id} ${f.label} ${f.placeholder}`.toLowerCase();
  if (f.type === 'email' || /e-?mail/.test(hint)) return 'qa+probe@example.com';
  if (f.type === 'tel' || /phone|tel\b/.test(hint)) return '+31 20 123 4567';
  if (f.type === 'url') return 'https://example.com';
  if (f.type === 'number') return String(Math.max(1, Number(f.min || 1)));
  if (f.type === 'date') return new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  if (/name/.test(hint)) return 'QA Tester';
  if (f.tag === 'textarea' || /message|comment|description|note/.test(hint)) return 'QA exploratory test message. Please ignore.';
  return 'QA test';
}
async function setField(page, f, value) {
  const loc = page.locator(`[data-qa-f="${f.key}"]`);
  if (f.tag === 'select') { await loc.selectOption({ index: f.options > 1 ? 1 : 0 }).catch(() => {}); return; }
  if (f.type === 'checkbox' || f.type === 'radio') { if (value !== '') await loc.check().catch(() => {}); return; }
  await loc.fill(value).catch(() => {});
}

// ---------- decide what to explore ----------
const candidates = map.pages.filter(p => p.status && p.status < 400 && !p.error && !p.leftOrigin && /html/.test((p.headers ?? {})['content-type'] ?? 'html'));
const interesting = p => (p.forms?.length || p.buttons?.some(b => !b.inForm));
const queue = [...candidates.filter(p => p.url === map.meta.startUrl || p.depth === 0), ...candidates.filter(interesting)];
const targets = [...new Map([...queue, ...candidates].map(p => [p.url, p])).values()].slice(0, maxPages);

const log = [];
const notes = [];
const note = s => notes.push(s);
const counts = { pages: 0, forms: 0, formCases: 0, searches: 0, controls: 0 };

// ---------- 1. forms ----------
async function exploreForms(rec) {
  const { page, st } = await openFresh(rec.url);
  const forms = (await page.evaluate(readForms)).slice(0, 8);
  await page.close();
  let done = 0;
  for (const form of forms) {
    const isSearch = form.method === 'get';
    if (isSearch || done >= maxForms) continue;
    if (!form.fields.length) continue;
    if (DESTRUCTIVE.test(form.submitText) || DESTRUCTIVE.test(form.action)) { note(`- Form #${form.index} (${form.submitText || 'no submit text'}): skipped, looks destructive or payment-related.`); continue; }
    done++; counts.forms++;
    const where = `${new URL(rec.url).pathname} form #${form.index}`;
    const entry = { kind: 'form', page: rec.url, path: new URL(rec.url).pathname + new URL(rec.url).search, form: { index: form.index, method: form.method, action: form.action, submitText: form.submitText, fields: form.fields }, cases: [] };
    note(`\n### Form #${form.index} on ${new URL(rec.url).pathname}: ${form.method.toUpperCase()} ${new URL(form.action).pathname}, submit "${form.submitText || 'none'}"`);
    note(`Fields: ${form.fields.map(f => `${f.name || f.id}(${f.type}${f.required ? ', required' : ''}${f.label ? '' : ', NO LABEL'})`).join(', ')}`);

    // Which cases to run. Each case changes ONE thing while everything else stays valid.
    const cases = [{ id: 'empty', title: 'all fields empty', values: () => ({}), invalid: true }];
    if (!form.hasPassword) {
      if (env === 'staging') cases.push({ id: 'valid', title: 'all fields valid (baseline)', values: f => Object.fromEntries(f.map(x => [x.key, validValue(x)])), invalid: false });
      for (const f of form.fields.filter(x => x.type === 'email' || /e-?mail/i.test(`${x.name} ${x.id} ${x.placeholder}`))) {
        for (const bad of ['plainaddress', 'user@']) cases.push({ id: `invalid-email:${bad}`, title: `invalid email "${bad}" in ${f.name || f.id}`, values: fs2 => ({ ...Object.fromEntries(fs2.map(x => [x.key, validValue(x)])), [f.key]: bad }), invalid: true, field: f });
      }
      for (const f of form.fields.filter(x => x.type === 'number')) {
        for (const bad of ['-1', '0']) cases.push({ id: `number:${bad}`, title: `number ${bad} in ${f.name || f.id}`, values: fs2 => ({ ...Object.fromEntries(fs2.map(x => [x.key, validValue(x)])), [f.key]: bad }), invalid: true, field: f });
      }
      const firstText = form.fields.find(x => ['text', 'search', ''].includes(x.type) && x.tag !== 'select');
      if (firstText) cases.push({ id: 'whitespace', title: `only spaces in ${firstText.name || firstText.id}`, values: fs2 => ({ ...Object.fromEntries(fs2.map(x => [x.key, validValue(x)])), [firstText.key]: '   ' }), invalid: true, field: firstText });
      if (env === 'staging') {
        const textFields = form.fields.filter(x => ['text', 'search', ''].includes(x.type) || x.tag === 'textarea');
        if (textFields.length) cases.push({ id: 'awkward', title: 'unicode, quotes and markup-looking text', values: fs2 => ({ ...Object.fromEntries(fs2.map(x => [x.key, validValue(x)])), [textFields[0].key]: 'Zoë Müller 你好 😀', [textFields.at(-1).key]: `O'Brien & "Sons" <Ltd> <i>x</i>` }), invalid: false });
      }
    }

    for (const c of cases.slice(0, 12)) {
      counts.formCases++;
      let obs;
      forceBlock = form.hasPassword; // credentials are never really sent, in any mode
      try {
        const { page, st } = await openFresh(rec.url);
        const live = await page.evaluate(readForms);
        const f = live[form.index];
        const values = c.values(f.fields);
        for (const fld of f.fields) await setField(page, fld, values[fld.key] ?? '');
        const before = await page.evaluate(snapshot);
        const w0 = st.writes.length, e0 = st.consoleErrors.length + st.pageErrors.length, s0 = st.serverErrors.length;
        const submit = page.locator('form').nth(form.index).locator('button:not([type=button]):not([type=reset]), input[type=submit]').first();
        if (await submit.count()) await submit.click({ timeout: 5000 }).catch(() => {}); else await page.locator(`[data-qa-f="${f.fields.at(-1).key}"]`).press('Enter').catch(() => {});
        await settleAfter(page);
        const after = await page.evaluate(snapshot);
        const d = diff(before, after);
        const feedback = [...d.newLive.map(x => x.text), ...d.added].join(' | ');
        const htmlInvalid = after.invalid;
        const writes = st.writes.length - w0;
        const errorLike = ERROR.test(feedback) || htmlInvalid.length > 0 || after.ariaInvalid > before.ariaInvalid;
        const successLike = SUCCESS.test(feedback) && !errorLike;
        const accepted = env === 'staging' ? (successLike || (writes > 0 && !errorLike)) : (writes > 0 && !errorLike);
        obs = { case: c.id, title: c.title, writes, status: st.writeResponses.at(-1)?.status ?? null, htmlInvalid: htmlInvalid.map(x => `${x.name}: ${x.message}`), feedback: feedback.slice(0, 200), accepted,
          announced: d.newLive.some(x => x.announced), newErrors: st.consoleErrors.length + st.pageErrors.length - e0, serverErrors: st.serverErrors.slice(s0), stackTrace: STACK.test(after.lines.join(' ')) };
        entry.cases.push(obs);

        const steps = `Open ${rec.url}; ${c.title}; press "${form.submitText || 'Enter'}".`;
        const outcome = accepted ? (writes ? `a ${st.writes.at(-1)?.method} request was ${env === 'readonly' ? 'attempted (blocked by the toolkit)' : 'sent'}` : 'a success message appeared') : (htmlInvalid.length ? `the browser blocked it (${htmlInvalid[0].message})` : feedback ? `feedback: "${feedback.slice(0, 80)}"` : 'nothing visible happened');
        note(`- ${c.title}: ${outcome}.${accepted && c.invalid ? ' **ACCEPTED**' : ''}`);

        if (c.invalid && accepted && !form.hasPassword) {
          const confirmed = env === 'staging' && successLike;
          const ev = await evidence(page, `${c.id}-accepted`);
          const rule = c.id === 'empty' ? 'explore-empty-submit-accepted' : c.id.startsWith('invalid-email') ? 'explore-invalid-email-accepted' : c.id.startsWith('number') ? 'explore-nonpositive-number-accepted' : 'explore-whitespace-accepted';
          const label = { 'explore-empty-submit-accepted': 'Form accepts an empty submission', 'explore-invalid-email-accepted': 'Form accepts an invalid email address', 'explore-nonpositive-number-accepted': 'Number field accepts zero or negative values', 'explore-whitespace-accepted': 'Required text field accepts whitespace only' }[rule];
          flag(rule, label, rule === 'explore-empty-submit-accepted' || rule === 'explore-invalid-email-accepted' ? 'functional' : 'functional', rule === 'explore-whitespace-accepted' ? 'low' : (confirmed && rule === 'explore-empty-submit-accepted' ? 'high' : 'medium'), {
            page: rec.url, steps, evidence: ev, confidence: confirmed ? 'high' : 'verify',
            actual: confirmed ? `The server answered with a success message ("${feedback.slice(0, 80)}") for: ${c.title}.` : `No client-side validation stopped it: ${c.title}. ${env === 'readonly' ? 'The request was blocked by the toolkit (read-only mode), so the server response is unknown.' : ''}`.trim(),
            expected: 'Invalid or empty input is rejected with a specific message next to the field, and nothing is saved or sent.',
            fix: 'Validate on the client (required, type="email", min/pattern) and again on the server; show a specific error beside the field.', standards: ['WCAG 3.3.1', 'WCAG 3.3.3'], detail: `${where}: ${c.title}`,
          });
        }
        if (c.invalid && !accepted && feedback && ERROR.test(feedback) && !obs.announced && !htmlInvalid.length) {
          flag('explore-error-not-announced', 'Validation errors are shown but not announced to assistive technology', 'accessibility', 'low', { page: rec.url, steps, actual: `Error text ("${feedback.slice(0, 60)}") appeared without role="alert"/role="status"/aria-live.`, expected: 'Errors are announced (live region) and linked to the field with aria-describedby.', fix: 'Render errors inside role="alert" or an aria-live region and set aria-invalid on the field.', standards: ['WCAG 3.3.1', 'WCAG 4.1.3'], detail: where });
        }
        if (obs.serverErrors.length) flag('explore-server-error', 'Server error (5xx) after submitting a form', 'functional', 'high', { page: rec.url, steps, confidence: 'high', actual: obs.serverErrors[0], expected: 'Bad input never causes a server error.', fix: 'Handle the input and return a validation error instead of crashing.', detail: `${where}: ${c.title}` });
        if (obs.stackTrace) flag('explore-stack-trace', 'Error page leaks a stack trace or internal details', 'security', 'high', { page: rec.url, steps, confidence: 'high', actual: 'The response after submitting contains stack-trace-like text.', expected: 'Users see a generic message; details stay in server logs.', fix: 'Disable debug output and add a generic error handler.', detail: `${where}: ${c.title}` });
        if (obs.newErrors > 0) flag('explore-js-error-on-interaction', 'JavaScript errors occur while using a form', 'functional', 'medium', { page: rec.url, steps, confidence: 'high', actual: `${obs.newErrors} new console/page error(s) after: ${c.title}.`, expected: 'Interacting with a form raises no script errors.', fix: 'Fix the script error.', detail: where });
        if (c.id === 'valid' && env === 'staging') {
          // double click on submit: duplicate submissions?
          const { page: p2, st: s2 } = await openFresh(rec.url);
          const live2 = (await p2.evaluate(readForms))[form.index];
          for (const fld of live2.fields) await setField(p2, fld, validValue(fld));
          const sub2 = p2.locator('form').nth(form.index).locator('button:not([type=button]):not([type=reset]), input[type=submit]').first();
          if (await sub2.count()) { await sub2.dblclick({ timeout: 5000 }).catch(() => {}); await settleAfter(p2); }
          if (s2.writes.length >= 2) flag('explore-double-submit', 'Double-clicking submit sends the form twice', 'functional', 'low', { page: rec.url, steps: `${steps} Double-click the submit button.`, actual: `${s2.writes.length} write requests were sent.`, expected: 'The submit control is disabled or the request de-duplicated after the first click.', fix: 'Disable the button while the request is in flight and make the endpoint idempotent.', detail: where });
          await p2.close();
        }
        await page.close();
      } catch (e) {
        note(`- ${c.title}: could not be run (${String(e.message).split('\n')[0].slice(0, 80)})`);
      } finally { forceBlock = false; }
    }
    log.push(entry);
  }
}

// ---------- 2. search (GET forms: safe on any environment) ----------
const STOP = new Set(['Home', 'Products', 'Product', 'Search', 'Results', 'Contact', 'About', 'Login', 'Welcome', 'Shop', 'Cart', 'Menu', 'Close', 'Submit', 'Learn', 'More']);
async function exploreSearch(rec) {
  const { page } = await openFresh(rec.url);
  const forms = await page.evaluate(readForms);
  const term = await page.evaluate(() => {
    const words = [...document.querySelectorAll('main h2,main h3,main b,main strong,main li,main td,[class*=title i],[class*=name i]')].flatMap(e => (e.innerText || '').split(/\s+/));
    return words.find(w => /^[A-Z][a-z]{3,11}$/.test(w)) || '';
  });
  await page.close();
  for (const form of forms.filter(f => f.method === 'get')) {
    const field = form.fields.find(x => ['text', 'search', ''].includes(x.type) && x.tag === 'input');
    if (!field || !(field.name || field.id)) continue;
    const action = new URL(form.action);
    if (action.origin !== origin || DESTRUCTIVE.test(action.pathname)) continue;
    counts.searches++;
    const param = field.name || field.id;
    const variants = [['empty', ''], ['nomatch', 'zzqa-no-such-item-xyz'], ['special', `%&"'<>`], ['long', 'a'.repeat(300)]];
    if (STOP.has(term) === false && term) variants.push(['exact', term], ['lower', term.toLowerCase()], ['upper', term.toUpperCase()]);
    const res = {};
    const entry = { kind: 'search', page: rec.url, path: action.pathname, action: action.pathname, param, term, results: {} };
    note(`\n### Search on ${new URL(rec.url).pathname}: GET ${action.pathname}?${param}=...  (sample term: ${term || 'none found'})`);
    for (const [name, value] of variants) {
      const u = new URL(action.href); u.searchParams.set(param, value);
      try {
        const { page: p, st } = await openFresh(u.href);
        const snap = await p.evaluate(snapshot);
        const text = snap.lines.join(' ');
        res[name] = { emptyState: EMPTY_STATE.test(text), status: st.serverErrors.length ? 500 : 200, errors: st.pageErrors.length, stack: STACK.test(text), lines: snap.lines.length };
        if (res[name].status >= 500 || res[name].stack || res[name].errors) flag('explore-search-error', 'Search breaks on unusual input', 'functional', 'high', { page: rec.url, confidence: 'high', steps: `Open ${rec.url}; search for ${name === 'special' ? 'special characters' : name === 'long' ? 'a 300 character string' : 'an empty query'}.`, actual: `Search "${name}": ${res[name].status >= 500 ? '5xx response' : res[name].stack ? 'stack trace visible' : 'script error'}.`, expected: 'Any query returns a normal results or empty-state page.', fix: 'Validate and escape the query; handle empty and very long input.', detail: `${action.pathname}?${param}=<${name}>` });
        await p.close();
      } catch (e) { res[name] = { error: String(e.message).split('\n')[0].slice(0, 80) }; }
    }
    entry.results = res;
    note(`Results by query: ${Object.entries(res).map(([k, v]) => `${k}=${v.error ? 'error' : v.emptyState ? 'empty-state' : 'content'}`).join(', ')}`);
    if (res.exact && res.exact.emptyState === false && (res.lower?.emptyState || res.upper?.emptyState)) {
      flag('explore-search-case-sensitive', 'Search is case-sensitive', 'functional', 'medium', { page: rec.url, confidence: 'high', steps: `Search for "${term}", then "${term.toLowerCase()}" and "${term.toUpperCase()}".`, actual: `"${term}" finds results but ${res.lower?.emptyState ? `"${term.toLowerCase()}"` : `"${term.toUpperCase()}"`} shows the empty state.`, expected: 'Search ignores letter case.', fix: 'Normalise case on both sides of the comparison (or use a case-insensitive collation).', detail: `${action.pathname}?${param}=` });
    }
    if (res.nomatch && !res.nomatch.emptyState && !res.nomatch.error) {
      flag('explore-search-no-empty-state', 'A search with no matches gives no "no results" message', 'ui-ux', 'low', { page: rec.url, confidence: 'verify', steps: `Search for a nonsense term on ${rec.url}.`, actual: 'The page shows no message such as "No results".', expected: 'An explicit empty state that helps the user try again.', fix: 'Show a clear "No results for ..." message with suggestions.', standards: ['WCAG 3.3.1'], detail: `${action.pathname}?${param}=zzqa-no-such-item-xyz` });
    }
    log.push(entry);
  }
}

// ---------- 3. buttons that are not form submits ----------
async function exploreControls(rec) {
  const { page } = await openFresh(rec.url);
  const all = await page.evaluate(readControls);
  await page.close();
  const seenText = new Map();
  const chosen = all.filter(c => {
    if (DESTRUCTIVE.test(c.text)) return false;
    const n = seenText.get(c.text) ?? 0; seenText.set(c.text, n + 1);
    return n < 1;
  }).slice(0, maxControls);
  if (!chosen.length) return;
  note(`\n### Buttons on ${new URL(rec.url).pathname}`);
  for (const c of chosen) {
    counts.controls++;
    const variants = c.qty === null ? [{ label: 'as is', q: null }] : [{ label: `quantity ${c.qty}`, q: c.qty }, { label: 'quantity 2', q: '2' }, { label: 'quantity 0', q: '0' }, { label: 'quantity -1', q: '-1' }];
    const entry = { kind: 'control', page: rec.url, path: new URL(rec.url).pathname, text: c.text, hasQty: c.qty !== null, variants: [] };
    for (const v of variants) {
      try {
        const { page: p, st } = await openFresh(rec.url);
        await p.evaluate(readControls);
        if (v.q !== null) await p.locator(`[data-qa-q="${c.key}"]`).fill(String(v.q)).catch(() => {});
        const before = await p.evaluate(snapshot);
        const e0 = st.consoleErrors.length + st.pageErrors.length, s0 = st.serverErrors.length;
        await p.locator(`[data-qa-c="${c.key}"]`).click({ timeout: 5000 }).catch(() => {});
        await settleAfter(p);
        const after = await p.evaluate(snapshot);
        const d = diff(before, after);
        const cartish = l => /cart|basket|bag|items?|qty|quantity|count/i.test(l);
        const nowLine = d.added.find(cartish), wasLine = d.removed.find(cartish);
        const nowNum = cartNumber(nowLine);
        const delta = nowNum === null ? null : nowNum - (cartNumber(wasLine) ?? 0);
        const rec2 = { variant: v.label, added: d.added.slice(0, 3), removed: d.removed.slice(0, 3), writes: st.writes.length, delta, urlChanged: after.url !== before.url, dialogs: st.dialogs, errors: st.consoleErrors.length + st.pageErrors.length - e0, serverErrors: st.serverErrors.slice(s0) };
        entry.variants.push(rec2);
        note(`- "${c.text}" (${v.label}): ${d.added.length || d.removed.length ? `changed "${(d.removed[0] ?? '').slice(0, 40)}" -> "${(d.added[0] ?? '').slice(0, 40)}"` : 'no visible change'}${rec2.writes ? `, ${rec2.writes} write request(s)${env === 'readonly' ? ' blocked' : ''}` : ''}${rec2.urlChanged ? ', navigated' : ''}${rec2.dialogs.length ? `, dialog "${rec2.dialogs[0]}"` : ''}`);
        const steps = `Open ${rec.url}; set the quantity to ${v.q ?? 'default'}; click "${c.text}".`;
        if (/add|cart|basket|bag/i.test(c.text) && v.q !== null && Number(v.q) > 0 && delta !== null && delta !== Number(v.q)) {
          flag('explore-cart-quantity-mismatch', 'Quantity shown after adding does not match what was added', 'functional', 'medium', { page: rec.url, steps, evidence: await evidence(p, 'quantity-mismatch'), actual: `Adding quantity ${v.q} changed the counter by ${delta} ("${(nowLine ?? '').slice(0, 40)}").`, expected: `The counter increases by the quantity added (${v.q}).`, fix: 'Check the quantity arithmetic where the cart total or count is updated.', detail: `"${c.text}" with quantity ${v.q}` });
        }
        if (v.q !== null && Number(v.q) <= 0 && delta !== null && delta !== 0 && !ERROR.test(d.added.join(' '))) {
          flag('explore-nonpositive-quantity-accepted', 'Zero or negative quantities change the cart', 'functional', 'medium', { page: rec.url, steps, evidence: await evidence(p, 'negative-quantity'), actual: `With quantity ${v.q} the counter changed by ${delta} and no error was shown.`, expected: 'Quantities below 1 are rejected (or the control prevents them with min="1").', fix: 'Add min="1" and validate the quantity before updating state.', detail: `"${c.text}" with quantity ${v.q}` });
        }
        if (rec2.serverErrors.length) flag('explore-server-error', 'Server error (5xx) after submitting a form', 'functional', 'high', { page: rec.url, steps, confidence: 'high', actual: rec2.serverErrors[0], expected: 'Interaction never causes a server error.', fix: 'Handle the request and return a validation error.', detail: `"${c.text}"` });
        if (rec2.errors > 0) flag('explore-js-error-on-interaction', 'JavaScript errors occur while using a form', 'functional', 'medium', { page: rec.url, steps, confidence: 'high', actual: `${rec2.errors} new script error(s) after clicking "${c.text}".`, expected: 'Interacting raises no script errors.', fix: 'Fix the script error.', detail: `"${c.text}"` });
        await p.close();
      } catch (e) { note(`- "${c.text}" (${v.label}): could not be run (${String(e.message).split('\n')[0].slice(0, 80)})`); }
    }
    log.push(entry);
  }
}

// ---------- 4. keyboard ----------
async function exploreKeyboard(rec) {
  const { page } = await openFresh(rec.url);
  try {
    const count = await page.evaluate(() => [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[tabindex="0"]')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.disabled; }).length);
    const seq = [];
    for (let i = 0; i < Math.min(count + 4, 45); i++) {
      await page.keyboard.press('Tab');
      seq.push(await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const r = e.getBoundingClientRect(); return `${e.tagName.toLowerCase()}:${(e.innerText || e.value || e.getAttribute('aria-label') || e.name || e.id || '').trim().slice(0, 24)}@${Math.round(r.top + scrollY)},${Math.round(r.left)}`; }));
    }
    const reached = new Set(seq.filter(Boolean));
    let run = 1, trap = false;
    for (let i = 1; i < seq.length; i++) { run = seq[i] && seq[i] === seq[i - 1] ? run + 1 : 1; if (run >= 4 && reached.size < count) trap = true; }
    const mouseOnly = await page.evaluate(mouseOnlyControls);
    note(`\n### Keyboard on ${new URL(rec.url).pathname}: ${count} interactive element(s), Tab reached ${reached.size}${trap ? ', FOCUS TRAP suspected' : ''}${mouseOnly.length ? `, ${mouseOnly.length} mouse-only control(s)` : ''}`);
    log.push({ kind: 'keyboard', page: rec.url, interactive: count, reached: reached.size, trap, mouseOnly });
    if (trap) flag('explore-keyboard-trap', 'Keyboard focus gets stuck', 'accessibility', 'high', { page: rec.url, steps: `Press Tab repeatedly on ${rec.url}.`, actual: 'Focus stayed on the same element for 4 consecutive Tab presses.', expected: 'Tab always moves on; no keyboard traps.', fix: 'Remove the focus handler that re-focuses the element.', standards: ['WCAG 2.1.2'], detail: new URL(rec.url).pathname });
    for (const m of mouseOnly) flag('explore-mouse-only-control', 'Clickable elements cannot be reached or used with the keyboard', 'accessibility', 'medium', { page: rec.url, steps: `Press Tab on ${rec.url}: this element never receives focus.`, evidence: undefined, confidence: 'high', actual: `<${m.tag}> "${m.text}" reacts to clicks but is not a button or link and has no tabindex/role.`, expected: 'Every control is a real <button>/<a> (or has role, tabindex and key handlers).', fix: 'Use a <button> element.', standards: ['WCAG 2.1.1', 'WCAG 4.1.2'], detail: `${new URL(rec.url).pathname}: ${m.html}` });
  } finally { await page.close(); }
}

// ---------- 5. navigation behaviour (once per site) ----------
async function exploreNavigation(rec) {
  const { page } = await openFresh(rec.url);
  try {
    const startTitle = await page.title();
    const link = await page.evaluate(o => { const a = [...document.querySelectorAll('nav a[href], a[href]')].find(x => x.origin === o && x.pathname !== location.pathname && !/log ?out|sign ?out|delete|remove/i.test(x.innerText + x.href)); return a ? a.href : null; }, origin);
    if (link) {
      await page.goto(link, { waitUntil: 'load', timeout }).catch(() => {});
      await page.goBack({ waitUntil: 'load', timeout }).catch(() => {});
      const back = page.url(), backTitle = await page.title();
      await page.goForward({ waitUntil: 'load', timeout }).catch(() => {});
      const forward = page.url();
      await page.reload({ waitUntil: 'load', timeout }).catch(() => {});
      const ok = new URL(back).pathname === new URL(rec.url).pathname && backTitle === startTitle && new URL(forward).pathname === new URL(link).pathname;
      note(`\n### Navigation: back, forward and refresh ${ok ? 'behave normally' : 'DID NOT behave normally'} (start ${new URL(rec.url).pathname} -> ${new URL(link).pathname}).`);
      if (!ok) flag('explore-history-broken', 'Back/forward navigation does not return to the previous page', 'functional', 'medium', { page: rec.url, steps: `Open ${rec.url}, follow a link, press Back then Forward.`, actual: `Back landed on ${back}; forward on ${forward}.`, expected: 'Back and forward restore the pages in order.', fix: 'Check client-side routing and history handling.', detail: link });
    }
    const r = await page.goto(`${origin}/qa-nonexistent-${Date.now()}`, { waitUntil: 'load', timeout }).catch(() => null);
    const links = await page.evaluate(() => document.querySelectorAll('a[href]').length).catch(() => 0);
    note(`### 404 page: status ${r?.status() ?? 'n/a'}, ${links} link(s) to continue.`);
    log.push({ kind: 'navigation', page: rec.url, notFoundStatus: r?.status() ?? null, notFoundLinks: links });
    if (links === 0) flag('explore-404-dead-end', 'The "not found" page offers no way forward', 'ui-ux', 'low', { page: `${origin}/<random-path>`, steps: 'Open a URL that does not exist.', actual: 'The page has no links.', expected: 'A link home or to search.', fix: 'Add navigation to the error page.', detail: '' });
  } finally { await page.close(); }
}

// ---------- run ----------
console.log(`Exploring ${targets.length} page(s) in ${env} mode${env === 'readonly' ? ' (all write requests are blocked)' : ''}`);
note(`# Exploration notes\n\nEnvironment: **${env}**${env === 'readonly' ? ' - every write request (POST/PUT/PATCH/DELETE) was blocked before leaving the browser.' : ' - submissions were sent with fake data.'}`);
for (const [i, rec] of targets.entries()) {
  counts.pages++;
  note(`\n## ${new URL(rec.url).pathname || '/'}`);
  for (const [name, fn] of [['forms', exploreForms], ['search', exploreSearch], ['controls', exploreControls], ['keyboard', exploreKeyboard], ...(i === 0 ? [['navigation', exploreNavigation]] : [])]) {
    try { await fn(rec); } catch (e) { note(`- ${name}: skipped (${String(e.message).split('\n')[0].slice(0, 100)})`); }
  }
  console.log(`[${i + 1}/${targets.length}] ${rec.url}`);
}
await browser.close();

const findings = [...found.values()];
const summary = { ...counts, writesBlocked: blockedWrites, writesAllowed: allowedWrites, anomalies: findings.length };
note(`\n---\nExplored ${counts.pages} page(s): ${counts.forms} form(s) in ${counts.formCases} case(s), ${counts.searches} search form(s), ${counts.controls} button(s). Write requests blocked: ${blockedWrites}, sent: ${allowedWrites}. Automatic anomalies: ${findings.length}.\nNot judged automatically: business rules, prices, wording, layout. Read these notes and the screenshots, then record real defects in manual-findings.json.`);
fs.writeFileSync(path.join(out, 'exploration-log.json'), JSON.stringify({ meta: { env, exploredAt: new Date().toISOString(), origin }, summary, entries: log }, null, 2));
fs.writeFileSync(path.join(out, 'exploration-notes.md'), notes.join('\n'));
fs.writeFileSync(path.join(out, 'explore-findings.json'), JSON.stringify(findings, null, 2));
console.log(`Done: ${counts.forms} form(s), ${counts.searches} search(es), ${counts.controls} button(s); ${findings.length} anomaly finding(s); writes blocked ${blockedWrites}, sent ${allowedWrites}.\nNotes: ${path.join(out, 'exploration-notes.md')}`);
