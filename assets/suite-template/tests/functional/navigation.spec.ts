import { test, expect } from '@playwright/test';
import { cfg, enabled, settle } from '../../helpers/site';

test.describe('navigation', () => {
  test.skip(!enabled('functional'), 'functional checks switched off in qa.config.json');

  test('back, forward and refresh behave normally', async ({ page }) => {
    const start = cfg.pages[0] ?? '/';
    await page.goto(start);
    await settle(page);
    const href = await page.evaluate(() => {
      const a = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].find(x => x.origin === location.origin && x.pathname !== location.pathname && !/log ?out|sign ?out|delete|remove/i.test(x.innerText + x.href));
      return a ? a.href : null;
    });
    test.skip(!href, 'no internal link to follow from the start page');
    const target = new URL(href!);
    await page.goto(href!);
    await page.goBack();
    expect(new URL(page.url()).pathname, 'Back returns to the start page').toBe(new URL(start, page.url()).pathname);
    await page.goForward();
    expect(new URL(page.url()).pathname, 'Forward returns to the second page').toBe(target.pathname);
    await page.reload();
    expect(new URL(page.url()).pathname, 'Refresh keeps the page').toBe(target.pathname);
  });

  test('an unknown URL returns 404 and offers a way forward', async ({ page }) => {
    const resp = await page.goto(`/qa-nonexistent-${Date.now()}`);
    expect(resp?.status(), 'status for a page that does not exist (a 200 here is a "soft 404")').toBe(404);
    expect(await page.locator('a[href]').count(), 'links on the not-found page').toBeGreaterThan(0);
  });
});
