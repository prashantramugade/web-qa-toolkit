import { test, expect } from '@playwright/test';
import { cfg, enabled, settle } from '../helpers/site';

// Budgets are deliberately loose; tighten them in qa.config.json ("perfBudgetMs") once you know your baseline.
const budgetMs = (cfg as { perfBudgetMs?: number }).perfBudgetMs ?? 4000;

for (const p of cfg.pages) {
  test.describe(p, () => {
    test('performance: loads within budget', async ({ page, browserName }, info) => {
      test.skip(!enabled('performance'), 'performance checks switched off in qa.config.json');
      test.skip(info.project.name !== 'chromium', 'timings are measured on the desktop project only');
      await page.goto(p);
      await settle(page);
      const t = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        return { ttfb: Math.round(nav.responseStart), load: Math.round(nav.loadEventEnd), requests: performance.getEntriesByType('resource').length };
      });
      expect(t.ttfb, `server response (TTFB) took ${t.ttfb} ms`).toBeLessThan(800);
      expect(t.load, `page load took ${t.load} ms`).toBeLessThan(budgetMs);
      expect(t.requests, `${t.requests} requests on load`).toBeLessThan(100);
    });
  });
}
