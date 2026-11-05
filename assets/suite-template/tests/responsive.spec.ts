import { test, expect } from '@playwright/test';
import { cfg, enabled, settle } from '../helpers/site';

// Runs in every project, so it covers the desktop and the mobile viewport configured in playwright.config.ts.
for (const p of cfg.pages) {
  test.describe(p, () => {
    test('responsive: no horizontal scroll', async ({ page }) => {
      test.skip(!enabled('responsive'), 'responsive checks switched off in qa.config.json');
      await page.goto(p);
      await settle(page);
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth, `page is ${overflow.scrollWidth}px wide in a ${overflow.clientWidth}px viewport`).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });

    test('responsive: has a viewport meta tag', async ({ page }) => {
      test.skip(!enabled('responsive'), 'responsive checks switched off in qa.config.json');
      await page.goto(p);
      expect(await page.locator('meta[name=viewport]').count(), 'viewport meta tag').toBeGreaterThan(0);
    });
  });
}
