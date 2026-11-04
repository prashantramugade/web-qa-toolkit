# Exploration playbook

How to learn what an app is for, drive it safely, and know when to stop.

## 1. Work out what the app is
From the crawl digest and a couple of screenshots, write `app-profile.json` in the output folder:
```json
{ "purpose": "", "audience": "", "type": "marketing | webshop | dashboard | docs | form-heavy | other",
  "primaryJourneys": ["..."], "techClues": ["framework, CMS, analytics"], "gaps": ["what the crawl could not see"] }
```
Primary journeys are the few things a visitor came to do (find a product, sign up, contact, search). Money, identity and data entry come first.

## 2. Drive the app with small scripts
Put scripts in `<out>/explore/` and run them with `node`. Pattern:
```js
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto(process.env.URL);
await page.waitForLoadState('networkidle');
await page.evaluate(() => document.fonts.ready);
// ...interact with getByRole / getByLabel, assert, collect evidence...
await page.screenshot({ path: 'qa-out/evidence/journey-step.png' });
await browser.close();
```
Also useful: `page.on('console' | 'pageerror' | 'requestfailed' | 'response', ...)` to catch problems while you click.

## 3. Side-effect safety
- Before any click that might submit, ask: could this create or change data? On production, stop before the final submit.
- Skip links and buttons named logout, delete, remove, cancel subscription, pay, confirm order.
- Use a throw-away identity on staging; never reuse real addresses.

## 4. Logged-in apps
Use credentials only if the user supplied them. Log in once in a script, then save the session:
```js
await context.storageState({ path: 'auth/user.json' });
```
Pass it to the crawler with `--storage-state auth/user.json`. Keep `auth/` out of git and out of reports.

## 5. Single-page apps
The crawler follows `<a href>` only. If the crawl found almost nothing, click through the navigation in a script, note each route, and add them to `qa.config.json` (`pages`) for the suite.

## 6. Confirm before you report
Reload the page fresh, wait for it to settle, repeat at the same viewport. If it does not reproduce, drop it. A half-loaded frame is not a defect.

## 7. When to stop
Stop when each primary journey has been walked once and every category you committed to has a result (pass, finding, or listed as not covered). More clicking after that rarely finds anything new.
