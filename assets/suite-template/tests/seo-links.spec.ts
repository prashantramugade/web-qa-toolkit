import { test, expect } from '@playwright/test';
import { cfg, enabled, settle } from '../helpers/site';

for (const p of cfg.pages) {
  test.describe(p, () => {
    test('seo: title, description and a single h1', async ({ page }) => {
      test.skip(!enabled('seo'), 'SEO checks switched off in qa.config.json (often irrelevant on internal sites)');
      await page.goto(p);
      await settle(page);
      expect(await page.title(), 'title').not.toBe('');
      expect(await page.locator('meta[name=description]').count(), 'meta description').toBeGreaterThan(0);
      expect(await page.locator('h1').count(), 'number of h1 headings').toBe(1);
    });

    test('links: internal links resolve', async ({ page, request }) => {
      test.skip(!enabled('links'), 'link checks switched off in qa.config.json');
      await page.goto(p);
      await settle(page);
      const origin = new URL(page.url()).origin;
      const hrefs: string[] = await page.$$eval('a[href]', as => [...new Set(as.map(a => (a as HTMLAnchorElement).href))]);
      const internal = hrefs.filter(h => h.startsWith(origin) && !/#$/.test(h)).slice(0, 40);
      const broken: string[] = [];
      for (const h of internal) {
        const r = await request.head(h, { failOnStatusCode: false }).catch(() => null);
        if (!r || r.status() >= 400) broken.push(`${r ? r.status() : 'no response'} ${h}`);
      }
      expect(broken, 'broken internal links').toEqual([]);
    });
  });
}
