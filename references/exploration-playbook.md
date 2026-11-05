# Exploration playbook

How to learn what an app is for, explore it the way a tester would, and know when to stop. The crawler tells you what
is on the pages; exploration tells you what the app does when someone uses it.

## 1. Work out what the app is
From `site-overview.mjs` and a few screenshots (home, a form page, the busiest page, a mobile one), write `OUT/app-profile.json`:
```json
{ "purpose": "", "audience": "", "type": "marketing | webshop | dashboard | docs | form-heavy | other",
  "primaryJourneys": ["..."], "techClues": ["framework, CMS, analytics"], "gaps": ["what the crawl could not see"] }
```
Primary journeys are the few things a visitor came to do (find a product, sign up, contact, search). The type sets your
priorities: a shop means cart and checkout arithmetic, a dashboard means roles and data, a brochure site means forms,
mobile and SEO. Money, identity and data entry come first.

## 2. Run the automatic exploration
```
node scripts/explore.mjs --site-map OUT/site-map.json --out OUT --env readonly
```
It visits the most interesting pages (home first, then pages with forms or buttons) and tries, one thing at a time:

| Area | What it does | What it can flag |
|---|---|---|
| Forms | Submits empty, then with an invalid email, zero or negative numbers, only spaces; on staging also a valid and an awkward-text case and a double click | accepted empty, invalid or whitespace input; 5xx after submit; stack traces; script errors; errors not announced to assistive technology; double submit |
| Search (GET forms) | Empty, no-match, special-character, 300-character and, when it finds a real term, upper/lower case queries | breaks on odd input, case-sensitive search, no empty-state message |
| Buttons | Clicks buttons that are not form submits and compares the page before and after; with a quantity field it tries the current value, 2, 0 and -1 | counter that does not match the quantity, zero or negative quantity accepted, script or 5xx errors |
| Keyboard | Presses Tab through the page | focus traps, clickable elements that are not buttons or links |
| Navigation | Follows a link, then Back, Forward and Refresh; opens a URL that does not exist | broken history, a 404 page with no way forward |

**Read-only mode** (`--env readonly`, the default) blocks every POST, PUT, PATCH and DELETE inside the browser, so nothing can
be created, sent or changed. The cost: the server's answer is never seen, so findings such as "form accepts an empty
submission" are marked `verify`. **Staging mode** (`--env staging`) really submits, with fake data (`QA Tester`,
`qa+probe@example.com`), and can confirm those findings. In both modes it never fills a form that has a password field and
never uses anything that looks destructive or like a payment.

Outputs: `exploration-notes.md` (what it did and saw, in order), `exploration-log.json` (structured; also feeds the generated
suite and the report's coverage section), `explore-findings.json` (automatic anomalies) and `screenshots/explore-*.png`.

## 3. Read the notes and judge
The explorer observes; you decide. Open `exploration-notes.md` and ask of each line: what would a sensible user or product
owner expect here? Things the script cannot judge: whether a price or total is right, whether an error message is helpful,
whether copy makes sense, whether a user should see this at all. Many "bugs" are a misreading; many real bugs are silent
(a wrong number, no feedback).

Confirm each finding before keeping it: reproduce it once more (fresh reload, same viewport). Drop what does not repeat.
Put real defects in `manual-findings.json`; if one replaces an automatic finding, list that rule in `supersedes`.

## 4. Drive the app yourself
Use short scripts in `OUT/explore/`, so they are part of the evidence and can seed suite tests:
```js
// OUT/explore/cart.mjs   run: node OUT/explore/cart.mjs
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
const log = [];
page.on('console', m => m.type() === 'error' && log.push(`console: ${m.text()}`));
page.on('pageerror', e => log.push(`pageerror: ${e.message}`));
page.on('response', r => r.status() >= 400 && log.push(`${r.status()} ${r.url()}`));

await page.goto(process.env.URL);
await page.getByRole('button', { name: 'Add to cart' }).first().click();
console.log('cart label:', await page.locator('#cart').innerText());   // observe, then compare with what is expected
await page.screenshot({ path: 'OUT/screenshots/cart-after-add.png' });
console.log(log);
await browser.close();
```
Habits that work:
- **Observe, then judge.** Print what happened before deciding it is wrong.
- **Evidence for everything:** a screenshot of the failing state, exact steps, the input used, observed versus expected.
- **Vary one thing at a time** (a field, a viewport) so you know the cause.
- **Look at the whole page**, not only what you clicked: layout, console, network.
- **Locate like a user:** `getByRole`, `getByLabel`, `getByText`. A control you can only reach by placeholder or CSS has no accessible name: record that as an accessibility finding.
- **Wait on conditions** (`expect(locator).toBeVisible()`, `waitForResponse`), never on fixed sleeps.

## 5. Side effects: be a careful guest
| Situation | Do |
|---|---|
| Staging, localhost, or the user said test data is fine | Submit with clearly fake data; clean up what you create if the UI allows |
| Production or a third-party site | Stay read-only: navigate, search, filter, open dialogs, trigger client-side validation without a successful submit |
| Payments, real emails or SMS, deleting accounts, anything irreversible | Do not complete it. Test up to the last confirmation and say so in "Not covered" |
| Login required | Use only credentials the user supplied; never guess or brute-force; never write them into output |

**Logged-in apps.** Log in once in a script (credentials from environment variables), then save the session:
`await context.storageState({ path: 'auth/user.json' })`. Pass it with `--storage-state auth/user.json` to the crawler and
the explorer. Keep `auth/` out of anything you deliver (it is in `.gitignore`).

**Single-page apps.** The crawler follows `<a href>` only. If it found one or two pages, click through the navigation in a
script, note each route, and add the routes to `qa.config.json` (`pages`) in the generated suite.

## 6. Turn what you learned into tests
`scaffold-suite.mjs` converts the exploration into functional specs: the forms, searches and quantity buttons it found each
get tests that mirror what it tried. Read-only checks (client-side validation) run anywhere; tests that submit data run only
with `ALLOW_WRITES=1` on a test environment. For journeys only a human can describe, copy
`assets/suite-template/tests/functional/_template.spec.ts.txt` (page objects and locator rules are explained there).

## 7. When to stop
Stop when every primary journey has been walked once, each kind of page has been seen on desktop and mobile, each form has had
its validation cases, and each category you committed to has an outcome (a finding, or "checked, no issue"). Record what you
chose to skip under "Not covered".
