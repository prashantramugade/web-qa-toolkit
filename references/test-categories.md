# Test categories, safety limits and severity

Use this when planning (what to cover) and when rating a defect (how bad it is).

## Categories and what to look at

**Functional**
- Every primary journey works start to finish; links and buttons do what their labels say.
- Forms: empty submit, wrong format, too long, special characters; messages are clear and tied to the field.
- Error states: 404 page, offline/slow response, back/forward, refresh mid-flow.
- Console errors, failed network requests, uncaught exceptions.

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
