#!/usr/bin/env node
// Turns crawl evidence (site-map.json) into automatic findings.
// One finding per rule, listing every page it was seen on.
// Usage: node scripts/analyze-crawl.mjs <out>/site-map.json   ->   <out>/auto-findings.json
//
// Everything here is deterministic. Judgement calls (business logic, confusing UX, content)
// are NOT guessed at: they come from exploration and go into manual-findings.json.
import fs from 'node:fs';
import path from 'node:path';

const input = process.argv[2];
if (!input) { console.error('Usage: node scripts/analyze-crawl.mjs <out>/site-map.json'); process.exit(1); }
const map = JSON.parse(fs.readFileSync(input, 'utf8'));

const origin = map.meta.origin;
const host = new URL(origin).hostname;
const isHttps = origin.startsWith('https:');
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(host) || host.endsWith('.local');
const site = map.site ?? {};

const found = new Map();
function add(rule, summary, category, severity, o = {}) {
  let f = found.get(rule);
  if (!f) {
    f = { rule, summary, category, severity, pages: [], actual: o.actual ?? '', expected: o.expected ?? '', fix: o.fix ?? '', standards: o.standards ?? [], details: [], confidence: o.confidence ?? 'high', source: 'auto' };
    found.set(rule, f);
  }
  if (o.page && !f.pages.includes(o.page)) f.pages.push(o.page);
  if (o.detail && !f.details.includes(o.detail) && f.details.length < 8) f.details.push(o.detail);
}

const header = (p, name) => (p.headers ?? {})[name.toLowerCase()] ?? '';
// content-level checks only make sense for pages that actually loaded (error responses are reported separately above)
const pages = map.pages.filter(p => p.status && p.status < 400 && !p.error && !p.leftOrigin);
const htmlPages = pages.filter(p => /html/.test(header(p, 'content-type')) || !header(p, 'content-type'));
const axeSeverity = { critical: 'high', serious: 'medium', moderate: 'low', minor: 'low' };

// ---------- availability and functional ----------
for (const p of map.pages) {
  if (p.error) add('page-load-error', 'Page failed to load or timed out', 'functional', 'high', { page: p.url, actual: `Navigation error: ${p.error}`, expected: 'Page loads with a 2xx status', fix: 'Check server logs, timeouts and redirects.', detail: `${p.url}: ${p.error}` });
  else if (p.status >= 400) add('page-http-error', `Page returns HTTP ${p.status}`, 'functional', 'high', { page: p.url, actual: 'A page that other pages link to returns an error status.', expected: 'Linked pages return 2xx', fix: 'Fix the route or remove the link that points to it.', detail: `${p.url} -> ${p.status}` });
}
const notFoundIs200 = site.notFound?.status === 200;
if (notFoundIs200) add('soft-404', 'Unknown URLs return HTTP 200 instead of 404 (soft 404)', 'functional', 'medium', { page: `${origin}/<random-path>`, actual: 'A random path that does not exist returned 200 with a "not found" page.', expected: 'Unknown URLs return 404, so users, crawlers and monitoring can tell the page is missing.', fix: 'Return status 404 from the catch-all route and keep the friendly page.' });
for (const p of pages) {
  if (notFoundIs200 && /not found|404|page missing/i.test(`${p.title} ${(p.h1 ?? []).join(' ')}`)) {
    add('link-to-missing-page', 'Internal links lead to a "Not found" page (hidden by a soft 404)', 'functional', 'high', { page: p.url, actual: `${p.url} renders a "not found" page with HTTP 200.`, expected: 'Internal links lead to real pages.', fix: 'Fix or remove the links that point here.', detail: `linked from ${p.discoveredFrom}` });
  }
}
for (const l of map.links ?? []) {
  if (l.status !== 0 && l.status < 400) continue;
  const where = (l.foundOn ?? [])[0];
  if (l.internal) add('broken-internal-link', 'Broken internal links', 'functional', 'high', { page: where, actual: 'Internal links return an error status.', expected: 'Every internal link resolves.', fix: 'Fix the href or restore the target page.', detail: `${l.href} -> ${l.status || l.error || 'no response'} (on ${(l.foundOn ?? []).slice(0, 2).join(', ')})` });
  else add('broken-external-link', 'Broken or unreachable external links', 'functional', 'low', { page: where, actual: 'External links return an error or are unreachable.', expected: 'External links resolve.', fix: 'Update or remove dead links. Some sites block bots, so verify by hand.', confidence: 'verify', detail: `${l.href} -> ${l.status || l.error || 'no response'}` });
}
for (const p of pages) {
  if (p.pageErrors?.length) add('js-uncaught-error', 'Uncaught JavaScript errors', 'functional', 'high', { page: p.url, actual: 'Unhandled exceptions are thrown while the page loads.', expected: 'No uncaught exceptions during a normal page load.', fix: 'Fix the script error: features may silently not work.', detail: `${p.url}: ${p.pageErrors[0]}` });
  const consoleErrors = (p.consoleErrors ?? []).filter(e => !/Failed to load resource/i.test(e)); // covered by the failed-request rule
  if (consoleErrors.length) add('console-errors', 'Errors logged to the browser console', 'functional', 'medium', { page: p.url, actual: 'console.error output during page load.', expected: 'A clean console.', fix: 'Investigate each error: they usually point at failed features or missing assets.', detail: `${p.url}: ${consoleErrors[0]}` });
  for (const r of p.badResponses ?? []) add('subresource-http-error', 'Sub-resources (scripts, images, API calls) return 4xx/5xx', 'functional', 'medium', { page: p.url, actual: 'Network requests fail while the page loads.', expected: 'All requests succeed.', fix: 'Fix missing assets or API routes.', detail: `${r.url} -> ${r.status} (${r.type})` });
  for (const r of p.failedRequests ?? []) add('request-failed', 'Network requests fail to complete', 'functional', 'medium', { page: p.url, actual: 'Requests were aborted or blocked.', expected: 'All requests complete.', fix: 'Check CORS, mixed content and unreachable hosts.', detail: `${r.url}: ${r.error}` });
  for (const im of p.images ?? []) if (im.broken) add('broken-image', 'Broken images', 'ui-ux', 'medium', { page: p.url, actual: 'Images failed to load.', expected: 'All images render.', fix: 'Fix the image URLs or remove the elements.', detail: im.src.slice(0, 100) });
  if (p.placeholderLinks) add('placeholder-links', 'Links with placeholder targets (href="#" or javascript:)', 'ui-ux', 'low', { page: p.url, actual: `${p.placeholderLinks} link(s) go nowhere.`, expected: 'Links lead somewhere; in-page actions are real buttons.', fix: 'Use a real URL, or a <button> for in-page actions.', standards: ['WCAG 4.1.2'] });

  for (const f of p.forms ?? []) {
    if (f.method === 'get' && f.fields.some(x => x.type === 'password')) add('password-in-get-form', 'Password field in a form that submits with GET', 'security', 'high', { page: p.url, actual: 'Credentials would appear in the URL, logs and history.', expected: 'Credentials are sent in a POST body.', fix: 'Use method="post".', standards: ['OWASP ASVS 2.1'] });
    if (!f.submit.length && f.fields.length) add('form-no-submit', 'Form without a visible submit button', 'ui-ux', 'low', { page: p.url, actual: `Form ${f.selector} has no submit control.`, expected: 'Users can submit with a labelled button.', fix: 'Add a submit button: Enter-to-submit alone is not discoverable.' });
    for (const fld of f.fields) {
      if (['hidden', 'submit', 'button', 'image', 'reset'].includes(fld.type) || fld.tag === 'button' || !fld.visible) continue;
      if (!fld.label) add('form-field-no-label', 'Form fields have no accessible label (placeholder only or nothing)', 'accessibility', 'high', { page: p.url, actual: 'Inputs rely on placeholder text or have no programmatic name.', expected: 'Every input has an associated <label> (or aria-label).', fix: 'Add <label for="..."> elements: placeholders vanish on input and are not labels.', standards: ['WCAG 1.3.1', 'WCAG 3.3.2', 'WCAG 4.1.2'], detail: `${p.url}: ${f.selector} > ${fld.selector} (placeholder: ${fld.placeholder || 'none'})` });
      if (/e-?mail/i.test(fld.name + fld.id + fld.placeholder) && fld.type !== 'email') add('email-field-wrong-type', 'Email fields are not type="email"', 'ui-ux', 'low', { page: p.url, actual: 'Plain text inputs are used for email addresses.', expected: 'type="email" gives built-in validation and the right mobile keyboard.', fix: 'Use <input type="email" autocomplete="email">.', standards: ['WCAG 1.3.5'], detail: `${p.url}: ${fld.selector}` });
      if (fld.type === 'password' && !fld.autocomplete) add('password-autocomplete', 'Password field has no autocomplete hint', 'security', 'info', { page: p.url, actual: 'No autocomplete attribute on a password field.', expected: 'autocomplete="current-password" or "new-password" helps password managers.', fix: 'Add the right autocomplete token.', standards: ['WCAG 1.3.5'] });
    }
    if (f.method === 'post' && !f.hasCsrfLikeField && f.fields.length && !f.fields.some(x => x.type === 'password')) add('no-csrf-token-visible', 'POST forms show no CSRF token (verify)', 'security', 'info', { page: p.url, actual: 'No hidden token field in the form markup.', expected: 'State-changing forms are protected by a token, SameSite cookies or origin checks.', fix: 'Confirm CSRF protection server-side.', standards: ['OWASP A01:2021'], confidence: 'verify', detail: `${p.url}: ${f.selector}` });
    if (isHttps && String(f.action).startsWith('http://')) add('form-posts-over-http', 'Form submits to an insecure (http://) URL', 'security', 'high', { page: p.url, actual: `Form action ${f.action}`, expected: 'Forms submit over HTTPS.', fix: 'Change the action to https://.', standards: ['OWASP A02:2021'] });
  }
  for (const ln of p.links ?? []) if (/^(click here|here|read more|learn more|more|link)$/i.test((ln.text ?? '').trim())) add('vague-link-text', 'Non-descriptive link text ("click here", "read more")', 'accessibility', 'low', { page: p.url, actual: 'Link text is meaningless out of context.', expected: 'Link text describes its destination.', fix: 'Use descriptive text or an aria-label.', standards: ['WCAG 2.4.4'], detail: `${p.url}: "${ln.text}" -> ${ln.raw}` });
}

// ---------- security (passive) ----------
if (!isHttps && !isLocal) add('no-https', 'Site is served over plain HTTP', 'security', 'high', { page: origin, actual: 'No TLS.', expected: 'HTTPS everywhere, with HTTP redirecting to HTTPS.', fix: 'Enable HTTPS and redirect HTTP.', standards: ['OWASP A02:2021'] });
for (const p of htmlPages) {
  const u = p.url, csp = header(p, 'content-security-policy');
  if (!csp) add('missing-csp', 'Content-Security-Policy header is missing', 'security', 'medium', { page: u, actual: 'No CSP on HTML responses.', expected: 'A restrictive CSP limits the impact of XSS.', fix: 'Add a Content-Security-Policy (start in report-only mode).', standards: ['OWASP Secure Headers'] });
  if (isHttps && !header(p, 'strict-transport-security')) add('missing-hsts', 'Strict-Transport-Security (HSTS) header is missing', 'security', 'medium', { page: u, actual: 'No HSTS over HTTPS.', expected: 'HSTS forces HTTPS on return visits.', fix: 'Add Strict-Transport-Security: max-age=31536000; includeSubDomains.', standards: ['OWASP Secure Headers'] });
  if (!header(p, 'x-frame-options') && !/frame-ancestors/.test(csp)) add('missing-clickjacking-protection', 'No clickjacking protection (X-Frame-Options / frame-ancestors)', 'security', 'medium', { page: u, actual: 'Pages can be embedded in third-party frames.', expected: 'X-Frame-Options or CSP frame-ancestors restricts framing.', fix: "Add X-Frame-Options: DENY (or frame-ancestors 'self').", standards: ['OWASP Clickjacking Defense'] });
  if (!/nosniff/i.test(header(p, 'x-content-type-options'))) add('missing-nosniff', 'X-Content-Type-Options: nosniff is missing', 'security', 'low', { page: u, actual: 'Browsers may MIME-sniff responses.', expected: 'nosniff is set.', fix: 'Add X-Content-Type-Options: nosniff.' });
  if (!header(p, 'referrer-policy')) add('missing-referrer-policy', 'Referrer-Policy header is missing', 'security', 'low', { page: u, actual: 'Full URLs may leak to other sites.', expected: 'A Referrer-Policy such as strict-origin-when-cross-origin.', fix: 'Add a Referrer-Policy header.' });
  const server = header(p, 'server'), powered = header(p, 'x-powered-by');
  if (powered || /\d+\.\d+/.test(server)) add('version-disclosure', 'Server technology or version disclosed in headers', 'security', 'low', { page: u, actual: `Server: ${server || '-'}; X-Powered-By: ${powered || '-'}`, expected: 'Headers do not reveal software versions.', fix: 'Remove X-Powered-By and trim the Server header.', standards: ['OWASP A05:2021'] });
  if (header(p, 'access-control-allow-origin') === '*') add('cors-wildcard', 'CORS allows any origin on an HTML page', 'security', 'low', { page: u, actual: 'Access-Control-Allow-Origin: *', expected: 'CORS restricted to trusted origins.', fix: 'Restrict the allowed origins.', confidence: 'verify' });
  if (p.passwordFields && !/no-store/i.test(header(p, 'cache-control'))) add('login-page-cacheable', 'Page with a password field is cacheable', 'security', 'low', { page: u, actual: `Cache-Control: ${header(p, 'cache-control') || '-'}`, expected: 'Sensitive pages send Cache-Control: no-store.', fix: 'Add Cache-Control: no-store to authentication pages.', standards: ['OWASP ASVS 8.2'] });
  if (p.passwordFields && !u.startsWith('https:') && !isLocal) add('password-over-http', 'Password field served over HTTP', 'security', 'critical', { page: u, actual: 'Credentials can be intercepted in transit.', expected: 'Login pages are HTTPS-only.', fix: 'Serve the whole site over HTTPS.', standards: ['OWASP A02:2021'] });
  if (p.mixedContent?.length || p.mixedContentRefs?.length) add('mixed-content', 'Mixed content (http:// resources on an https:// page)', 'security', 'high', { page: u, actual: 'Insecure sub-resources on a secure page.', expected: 'All sub-resources use HTTPS.', fix: 'Update the URLs to https://.', standards: ['OWASP A02:2021'], detail: (p.mixedContent?.[0] ?? p.mixedContentRefs?.[0]) });
  if (p.blankTargetNoRel) add('blank-no-noopener', 'target="_blank" links without rel="noopener"', 'security', 'low', { page: u, actual: `${p.blankTargetNoRel} link(s).`, expected: 'Links that open new tabs use rel="noopener noreferrer".', fix: 'Add rel="noopener noreferrer".', standards: ['OWASP Reverse Tabnabbing'] });
  for (const s of p.externalScripts ?? []) {
    if (new URL(s.src).hostname !== host && !s.integrity) add('script-no-sri', 'Third-party scripts loaded without Subresource Integrity', 'security', 'low', { page: u, actual: 'Cross-origin scripts have no integrity hash.', expected: 'Third-party scripts use SRI or are self-hosted.', fix: 'Add integrity and crossorigin attributes, or self-host.', standards: ['OWASP A08:2021'], detail: s.src.slice(0, 100) });
  }
  for (const c of p.cookiesSeen ?? []) {
    const session = /sess|auth|token|sid|jwt|login/i.test(c.name);
    if (!c.httpOnly) add('cookie-no-httponly', 'Cookies missing the HttpOnly flag', 'security', session ? 'medium' : 'low', { page: u, actual: 'Cookies are readable by JavaScript.', expected: 'Session and auth cookies are HttpOnly.', fix: 'Set HttpOnly on session cookies.', standards: ['OWASP A05:2021'], detail: `${c.name} (session-like: ${session})` });
    if (isHttps && !c.secure) add('cookie-no-secure', 'Cookies missing the Secure flag', 'security', session ? 'medium' : 'low', { page: u, actual: 'Cookies can be sent over HTTP.', expected: 'Cookies are Secure.', fix: 'Set the Secure flag.', standards: ['OWASP A05:2021'], detail: c.name });
  }
}
for (const pr of map.probes ?? []) {
  if (pr.reflectedRaw && /html/.test(pr.contentType)) add('reflected-input-unencoded', 'Possible reflected XSS: query input echoed without HTML encoding', 'security', 'high', { page: pr.url, actual: `Parameter "${pr.param}" came back verbatim: a harmless <i> marker appeared unencoded in the response.`, expected: 'User input is HTML-encoded wherever it is rendered.', fix: "Encode output by context (use the framework's auto-escaping) and add a CSP.", standards: ['OWASP A03:2021', 'CWE-79'], detail: `${pr.url}?${pr.param}=...` });
}
if (site.securityTxt?.status !== 200 || !/text\/plain/.test(site.securityTxt?.contentType ?? '')) add('no-security-txt', 'No security.txt vulnerability-disclosure file', 'security', 'info', { page: `${origin}/.well-known/security.txt`, actual: 'Not found.', expected: 'A security.txt tells researchers how to report issues.', fix: 'Publish /.well-known/security.txt (RFC 9116).', standards: ['RFC 9116'] });

// ---------- accessibility ----------
const wcag = t => { const d = t.slice(4); return `WCAG ${d[0]}.${d[1]}.${d.slice(2)}`; };
for (const p of pages) {
  const u = p.url;
  for (const v of p.a11y?.violations ?? []) {
    const n = v.nodes?.[0] ?? {};
    add(`axe-${v.id}`, `${v.help} (axe: ${v.id})`, 'accessibility', axeSeverity[v.impact] ?? 'low', { page: u, actual: 'Elements fail this axe-core rule (see examples).', expected: 'The page passes this WCAG check.', fix: `See ${v.helpUrl}`, standards: (v.tags ?? []).filter(t => /^wcag\d{3,4}$/.test(t)).map(wcag), detail: `${u}: ${n.target ?? ''} ${(n.html ?? '').slice(0, 90)}` });
  }
  if (!p.lang) add('no-lang', '<html> element has no lang attribute', 'accessibility', 'medium', { page: u, actual: 'Page language is not declared.', expected: '<html lang="en"> (or the right language).', fix: 'Add the lang attribute so screen readers pick the right voice.', standards: ['WCAG 3.1.1'] });
  if (!p.landmarks?.main) add('no-main-landmark', 'No <main> landmark', 'accessibility', 'low', { page: u, actual: 'No main landmark.', expected: 'Primary content is wrapped in <main>.', fix: 'Add <main>.', standards: ['WCAG 1.3.1', 'WCAG 2.4.1'] });
  if (!p.hasSkipLink && p.nav?.length) add('no-skip-link', 'No "Skip to content" link', 'accessibility', 'low', { page: u, actual: 'Keyboard users must tab through the whole navigation on every page.', expected: 'A skip link is the first focusable element.', fix: 'Add <a href="#main">Skip to content</a>.', standards: ['WCAG 2.4.1'] });
  if (p.keyboard?.tabStops && !p.keyboard.focusVisibleOnAll) add('focus-not-visible', 'Keyboard focus indicator is missing or hard to see', 'accessibility', 'medium', { page: u, actual: 'Some focusable controls show no outline or focus ring.', expected: 'Every focusable element has a visible focus style.', fix: 'Do not remove outlines without a :focus-visible style.', standards: ['WCAG 2.4.7'], detail: `${u}: ${JSON.stringify(p.keyboard.offenders ?? []).slice(0, 160)}` });
  if (p.positiveTabindex) add('positive-tabindex', 'Positive tabindex values disturb the tab order', 'accessibility', 'low', { page: u, actual: `${p.positiveTabindex} element(s).`, expected: 'Natural DOM order; tabindex 0 or -1 only.', fix: 'Remove positive tabindex values.', standards: ['WCAG 2.4.3'] });
  if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(p.viewportMeta ?? '')) add('zoom-disabled', 'Pinch-zoom is disabled via the viewport meta tag', 'accessibility', 'medium', { page: u, actual: `viewport: ${p.viewportMeta}`, expected: 'Users can zoom to 200% or more.', fix: 'Remove user-scalable=no and maximum-scale=1.', standards: ['WCAG 1.4.4'] });
  const hs = p.headings ?? [];
  if (hs.some((h, i) => i && h.level - hs[i - 1].level > 1)) add('heading-skip', 'Heading levels are skipped', 'accessibility', 'low', { page: u, actual: 'For example an h1 followed by an h3.', expected: 'Headings descend one level at a time.', fix: 'Fix the heading outline.', standards: ['WCAG 1.3.1'] });
}

// ---------- SEO and content ----------
const titles = new Map();
for (const p of htmlPages) {
  const u = p.url, t = p.title ?? '';
  titles.set(t, [...(titles.get(t) ?? []), u]);
  if (!t) add('seo-no-title', 'Page has no <title>', 'seo', 'medium', { page: u, actual: 'Missing title.', expected: 'A unique, descriptive title.', fix: 'Add a <title>.', standards: ['WCAG 2.4.2'] });
  else if (t.length > 70) add('seo-title-long', 'Page title is longer than about 70 characters', 'seo', 'low', { page: u, actual: `${t.length} characters.`, expected: '60 characters or fewer avoids truncation.', fix: 'Shorten the title.' });
  if (!p.metaDescription) add('seo-no-meta-description', 'Missing meta description', 'seo', 'low', { page: u, actual: 'No meta description.', expected: 'A 50-160 character description per page.', fix: 'Add <meta name="description">.' });
  if (!p.h1?.length) add('seo-no-h1', 'Page has no <h1>', 'seo', 'low', { page: u, actual: 'No top-level heading.', expected: 'Exactly one h1 describing the page.', fix: 'Add one h1.', standards: ['WCAG 2.4.6'] });
  else if (p.h1.length > 1) add('seo-multiple-h1', 'Page has more than one <h1>', 'seo', 'low', { page: u, actual: `${p.h1.length} h1 elements.`, expected: 'One h1 per page.', fix: 'Demote the extra h1 elements.', standards: ['WCAG 1.3.1'] });
  if (/noindex/i.test(p.robotsMeta ?? '')) add('seo-noindex', 'Page is set to noindex', 'seo', 'info', { page: u, actual: p.robotsMeta, expected: 'Intentional?', fix: 'Confirm noindex is intended.', confidence: 'verify' });
  if (!p.viewportMeta) add('no-viewport-meta', 'Missing viewport meta tag', 'responsive', 'high', { page: u, actual: 'Mobile browsers render at desktop width.', expected: '<meta name="viewport" content="width=device-width, initial-scale=1">', fix: 'Add the viewport meta tag.', standards: ['WCAG 1.4.10'] });
}
for (const [t, us] of titles) if (t && us.length > 1) add('seo-duplicate-title', 'Duplicate page titles', 'seo', 'low', { page: us[0], actual: 'Several pages share one title.', expected: 'Unique titles.', fix: 'Give each page a distinct title.', detail: `"${t}" on ${us.length} pages` });
const missing = r => r?.status !== 200 || /html/.test(r?.contentType ?? '');
if (missing(site.robots)) add('seo-no-robots', 'robots.txt not found', 'seo', 'low', { page: `${origin}/robots.txt`, actual: `status ${site.robots?.status}`, expected: 'robots.txt exists, even if permissive.', fix: 'Add robots.txt with a Sitemap: line.' });
if (missing(site.sitemap)) add('seo-no-sitemap', 'sitemap.xml not found', 'seo', 'low', { page: `${origin}/sitemap.xml`, actual: `status ${site.sitemap?.status}`, expected: 'A sitemap lists indexable URLs.', fix: 'Generate sitemap.xml.' });
if (missing(site.favicon)) add('no-favicon', 'No favicon at /favicon.ico', 'ui-ux', 'info', { page: `${origin}/favicon.ico`, actual: `status ${site.favicon?.status}`, expected: 'A favicon identifies the tab and avoids 404 noise.', fix: 'Add a favicon and <link rel="icon">.' });

// ---------- performance (lab data from one run: a smoke detector, not a verdict) ----------
for (const p of pages) {
  const pf = p.perf ?? {}, u = p.url;
  if (pf.ttfbMs > 800) add('perf-slow-ttfb', 'Slow server response (TTFB over 800 ms)', 'performance', 'medium', { page: u, actual: `TTFB ${pf.ttfbMs} ms`, expected: '800 ms or less', fix: 'Profile the backend; add caching or a CDN.', confidence: 'medium' });
  if (pf.lcpMs > 4000) add('perf-lcp-poor', 'Largest Contentful Paint is poor (over 4 s)', 'performance', 'high', { page: u, actual: `LCP ${pf.lcpMs} ms`, expected: '2.5 s or less', fix: 'Optimise the hero image or text; preload critical assets.', confidence: 'medium', detail: `${u}: ${pf.lcpMs} ms` });
  else if (pf.lcpMs > 2500) add('perf-lcp-needs-work', 'Largest Contentful Paint needs improvement (over 2.5 s)', 'performance', 'medium', { page: u, actual: `LCP ${pf.lcpMs} ms`, expected: '2.5 s or less', fix: 'Optimise the largest element.', confidence: 'medium', detail: `${u}: ${pf.lcpMs} ms` });
  if (pf.cls > 0.1) add('perf-cls', 'Layout shifts during load (CLS over 0.1)', 'performance', pf.cls > 0.25 ? 'high' : 'medium', { page: u, actual: `CLS ${pf.cls}`, expected: '0.1 or less', fix: 'Reserve space for images, ads and fonts.', confidence: 'medium', detail: `${u}: ${pf.cls}` });
  if (pf.transferKB > 3000) add('perf-heavy-page', 'Page weight exceeds 3 MB', 'performance', 'medium', { page: u, actual: `${pf.transferKB} KB`, expected: 'Under 1-2 MB', fix: 'Compress images, split bundles, lazy-load.', detail: `${u}: ${pf.transferKB} KB` });
  if (pf.requests > 100) add('perf-many-requests', 'More than 100 requests on load', 'performance', 'low', { page: u, actual: `${pf.requests} requests`, expected: 'Fewer, cacheable requests', fix: 'Bundle or inline critical assets.' });
  if (pf.longTaskMs > 300) add('perf-long-tasks', 'Main thread blocked by long tasks (over 300 ms total)', 'performance', 'low', { page: u, actual: `${pf.longTasks} long task(s), ${pf.longTaskMs} ms`, expected: 'Short tasks keep the page responsive.', fix: 'Split heavy JavaScript; defer non-critical work.', confidence: 'medium' });
  if (p.wordCount > 0 && !header(p, 'content-encoding') && /html/.test(header(p, 'content-type')) && !isLocal) add('perf-no-compression', 'HTML responses are not compressed', 'performance', 'low', { page: u, actual: 'No Content-Encoding header.', expected: 'gzip or brotli enabled.', fix: 'Enable compression on the server or CDN.' });
}

// ---------- responsive ----------
for (const p of pages) {
  const m = p.mobile ?? {};
  if (m.horizontalOverflow) add('mobile-horizontal-overflow', 'Content overflows horizontally on a 390 px mobile viewport', 'responsive', 'high', { page: p.url, actual: `Page is ${m.scrollWidth} px wide on a ${m.deviceWidth} px screen; offenders: ${(m.overflowing ?? []).slice(0, 3).join(', ')}`, expected: 'No horizontal scrolling at 320-430 px.', fix: 'Make wide elements fluid (max-width: 100%, responsive tables).', standards: ['WCAG 1.4.10'], detail: `${p.url}: ${(m.overflowing ?? []).slice(0, 3).join(', ')}` });
  if (m.smallTapTargets >= 3) add('mobile-small-tap-targets', 'Interactive elements smaller than 24x24 px on mobile', 'responsive', 'low', { page: p.url, actual: `${m.smallTapTargets} element(s).`, expected: 'Targets of at least 24x24 CSS px (44x44 recommended).', fix: 'Increase the size or spacing of touch targets.', standards: ['WCAG 2.5.8'] });
  if (m.tinyTextElements >= 3) add('mobile-tiny-text', 'Text smaller than 12 px', 'responsive', 'low', { page: p.url, actual: `${m.tinyTextElements} element(s).`, expected: 'Body text of 16 px; nothing below 12 px.', fix: 'Raise the font sizes.', standards: ['WCAG 1.4.4'] });
}

const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const findings = [...found.values()].sort((a, b) => rank[a.severity] - rank[b.severity] || a.category.localeCompare(b.category) || a.rule.localeCompare(b.rule));
findings.forEach(f => { f.occurrences = f.pages.length || 1; });
const dest = path.join(path.dirname(input), 'auto-findings.json');
fs.writeFileSync(dest, JSON.stringify(findings, null, 2));
const by = findings.reduce((a, f) => ((a[f.severity] = (a[f.severity] ?? 0) + 1), a), {});
console.log(`${findings.length} automatic findings (${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}) -> ${dest}`);
