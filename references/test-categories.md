# Test categories, safety limits and severity

Use this when planning (what to cover) and when rating a defect (how bad it is).

## Categories and what to look at

**Functional** (ask of every feature: what is it for, what would a user try, how could it go wrong?)
- Happy path first: complete each primary journey the way the product intends (browse, select, add, check out; sign up, use). If the happy path breaks, report that before anything else.
- Navigation: every nav and footer link lands on the right page; the active state is right; the logo goes home; Back, Forward and Refresh keep state sensibly; deep links open directly; trailing slashes and letter case do not break routes.
- Search, filter, sort, pagination: empty query, no results (is there a helpful empty state?), upper/lower case, special characters, very long input, filters that combine, first and last page, out-of-range page, does the count match the list?
- State and data: create, read, update, delete round trips; edits survive a refresh; counters, totals and badges add up (quantity times price, tax, rounding); a change in one place shows everywhere it appears.
- Error handling: 404 and 500 pages, slow or failed requests, double-clicking submit (duplicate orders?), Back after submit.
- Business rules: look for limits stated in the copy (minimum order, maximum quantity, password rules) and test just below, at and just above them.
- Third-party widgets (maps, chat, payment, embeds): do they load, and does the page degrade gracefully when they do not?
- Console errors, failed requests and uncaught exceptions during all of the above.

**Forms and validation** (change one thing at a time, keep everything else valid)
| Class | Examples |
|---|---|
| Empty or required | empty, only spaces |
| Valid | typical value, minimum length, maximum length |
| Just outside the limits | one over the maximum, one under the minimum, zero, negative, decimal, huge number |
| Wrong format | email without `@`, phone with letters, a past date where only future dates make sense |
| Awkward but legitimate | `O'Brien`, `Zoë`, `你好`, leading and trailing spaces, `+` in an email address |
- Is the input checked in the browser and again on the server? Is the error specific, next to the field, and announced to assistive technology? Is what the user typed kept after an error? Does Enter submit? Is the success state unambiguous?
- `explore.mjs` covers the empty, invalid-email, number and whitespace cases automatically; business-specific limits still need a human.

**Login and sessions** (only with credentials the user supplied; never guess passwords; the toolkit itself never fills a password field)
- Wrong password and unknown user should give the same generic message (different messages let attackers find valid accounts). Logout must really end the session. Protected pages must redirect when logged out. Normal users must not see admin links.

**Keyboard and focus**
- Tab reaches every control in a sensible order, focus is visible, nothing traps it, and anything that reacts to a click can also be used with the keyboard (real buttons or links, not clickable divs).

**UI / UX**
- Consistent spacing, alignment and typography; no clipped or overlapping content once the page has settled.
- Clear primary action per screen; feedback after actions (loading, success, error).
- Sensible empty states and long-content behaviour.

**Accessibility (WCAG 2.1 A/AA)**
- Automated: axe-core results (contrast, names, labels, landmarks, ARIA misuse).
- Manual: keyboard-only walk (tab order, visible focus, no traps), page language, heading order, alt text meaning, form labels, zoom to 200%.

**Security (passive only)**
- Response headers (HSTS, CSP, X-Content-Type-Options, Referrer-Policy), cookie flags, mixed content.
- Information leaks: stack traces, version banners, debug pages, exposed source maps.
- One inert reflection marker in a search or query field, judged by whether it comes back unescaped.

**Responsive**
- 390 / 768 / 1280 px: no horizontal scroll, readable text, tappable targets, working navigation.

**SEO and links**
- Title, meta description, one h1, canonical, language; broken internal links (and a sample of external ones).

**Performance**
- Time until the page settles, oversized images, blocking scripts. Report layout shift only with repeated measurements.

## Rules of engagement
- Production: read-only. Never create accounts, orders or messages, never pay, never delete. Check validation without completing a submit.
- Staging or localhost: submitting is fine with obviously fake data (`QA Tester`, `qa+probe@example.com`).
- Never: brute force, fuzzing, script-executing payloads, authentication bypass, other users' data, load testing, bot-protection evasion.
- If the site blocks the tool, report that and stop.

## Severity rubric
| Level | Meaning | Examples |
|---|---|---|
| critical | Users cannot complete a core task, or data/security is at real risk | Checkout fails; login broken; sensitive data exposed |
| high | A major feature is broken or a large group is blocked | Page returns 500; form cannot be submitted by keyboard; contrast failure on the main action |
| medium | Noticeable problem with a workaround | Console errors, layout overflow on mobile, missing labels |
| low | Polish or hygiene | Missing meta description, extra h1, missing optional headers |

Rate by user impact, not by how easy it was to detect.
