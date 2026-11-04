import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';

// Data-driven: one set of checks per page listed in qa.config.json (written by scaffold-suite.sh).
// Add app-specific journeys under tests/functional/ (see tests/functional/_template.spec.ts.txt).
const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../qa.config.json'), 'utf8')) as {
  baseURL: string; pages: string[]; skipChecks?: string[];
};
const skip = new Set(cfg.skipChecks ?? []);
const enabled = (name: string) => !skip.has(name);

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
}

for (const p of cfg.pages) {
  test.describe(p, () => {
    test('smoke: loads cleanly', async ({ page }) => {
      test.skip(!enabled('smoke'));
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(String(e)));
      const resp = await page.goto(p);
      expect(resp?.status(), 'HTTP status').toBeLessThan(400);
      await settle(page);
      expect(await page.title(), 'page has a title').not.toBe('');
      expect(errors, 'no uncaught JavaScript errors').toEqual([]);
    });

    test('a11y: no serious or critical WCAG violations', async ({ page }) => {
      test.skip(!enabled('a11y'));
      await page.goto(p);
      await settle(page);
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      const serious = violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map(v => `${v.id} (${v.nodes.length})`)).toEqual([]);
    });

    test('responsive: no horizontal scroll', async ({ page }) => {
      test.skip(!enabled('responsive'));
      await page.goto(p);
      await settle(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflow).toBe(false);
    });

    test('seo: title, description and a single h1', async ({ page }) => {
      test.skip(!enabled('seo'));
      await page.goto(p);
      await settle(page);
      expect(await page.locator('meta[name=description]').count(), 'meta description').toBeGreaterThan(0);
      expect(await page.locator('h1').count(), 'number of h1').toBe(1);
    });

    test('security: baseline response headers (https only)', async ({ request }) => {
      test.skip(!enabled('security') || !cfg.baseURL.startsWith('https:'), 'headers are checked on https targets only');
      const headers = (await request.get(p)).headers();
      for (const name of ['strict-transport-security', 'x-content-type-options', 'content-security-policy']) {
        expect(headers[name], `header ${name}`).toBeTruthy();
      }
    });
  });
}
