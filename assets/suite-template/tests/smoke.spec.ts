import { test, expect } from '@playwright/test';
import { cfg, enabled, settle, ignoreFailed, ignoreConsole } from '../helpers/site';

// One describe block per page found by the crawl. Each block is titled with the page path, so reports can name the page.
for (const p of cfg.pages) {
  test.describe(p, () => {
    test('smoke: loads cleanly', async ({ page }) => {
      test.skip(!enabled('smoke'), 'smoke checks switched off in qa.config.json');
      const problems: string[] = [];
      const failedRequests: string[] = [];
      page.on('pageerror', e => problems.push(`uncaught: ${e.message}`));
      page.on('console', m => {
        if (m.type() === 'error' && !/Failed to load resource/i.test(m.text()) && !ignoreConsole(m.text())) problems.push(`console: ${m.text()}`);
      });
      page.on('response', r => { if (r.status() >= 400 && !ignoreFailed(r.url())) failedRequests.push(`${r.status()} ${r.url()}`); });

      const resp = await page.goto(p);
      expect(resp?.status(), 'HTTP status of the page').toBeLessThan(400);
      await settle(page);
      expect(await page.title(), 'page has a title').not.toBe('');
      expect(problems, 'script and console errors').toEqual([]);
      expect(failedRequests, 'failed requests (4xx/5xx)').toEqual([]);
    });
  });
}
