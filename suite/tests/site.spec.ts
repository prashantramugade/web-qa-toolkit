import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';

// Data-driven from the crawl: one set of checks per discovered page.
// Override the file with SITE_MAP=path/to/site-map.json
const mapPath = process.env.SITE_MAP ?? path.resolve(__dirname, '../../qa-out/site-map.json');
const paths: string[] = fs.existsSync(mapPath)
  ? JSON.parse(fs.readFileSync(mapPath, 'utf8')).pages.filter((p: any) => !p.error).map((p: any) => new URL(p.url).pathname + new URL(p.url).search)
  : ['/'];

async function settle(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
}

for (const p of paths) {
  test.describe(p, () => {
    test('smoke: loads without errors', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(String(e)));
      const resp = await page.goto(p);
      expect(resp?.status(), 'HTTP status').toBeLessThan(400);
      await settle(page);
      expect(await page.title(), 'has a title').not.toBe('');
      expect(errors, 'no uncaught JS errors').toEqual([]);
    });

    test('a11y: no serious/critical axe violations', async ({ page }) => {
      await page.goto(p);
      await settle(page);
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      const bad = violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map(v => `${v.id} (${v.nodes.length})`)).toEqual([]);
    });

    test('responsive: no horizontal scroll', async ({ page }) => {
      await page.goto(p);
      await settle(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      expect(overflow).toBe(false);
    });

    test('security: baseline headers (https only)', async ({ request, baseURL }) => {
      test.skip(!baseURL?.startsWith('https:'), 'headers checked on https targets only');
      const r = await request.get(p);
      const h = r.headers();
      for (const name of ['strict-transport-security', 'x-content-type-options', 'content-security-policy']) {
        expect(h[name], `header ${name}`).toBeTruthy();
      }
    });
  });
}
