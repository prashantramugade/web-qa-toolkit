import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { cfg, enabled, settle } from '../helpers/site';
import { mouseOnlyControls } from '../helpers/observe';

for (const p of cfg.pages) {
  test.describe(p, () => {
    test('a11y: no serious or critical WCAG violations', async ({ page }) => {
      test.skip(!enabled('a11y'), 'accessibility checks switched off in qa.config.json');
      await page.goto(p);
      await settle(page);
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      const serious = violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map(v => `${v.id} (${v.nodes.length} element${v.nodes.length === 1 ? '' : 's'})`)).toEqual([]);
    });

    test('keyboard: Tab reaches every interactive element', async ({ page }) => {
      test.skip(!enabled('a11y'), 'accessibility checks switched off in qa.config.json');
      await page.goto(p);
      await settle(page);
      const total = await page.evaluate(() => {
        const vis = (e: Element) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
        return [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[tabindex="0"]')]
          .filter(e => vis(e) && !(e as HTMLInputElement).disabled && e.getAttribute('tabindex') !== '-1').length;
      });
      for (let i = 0; i < Math.min(total + 4, 60); i++) {
        await page.keyboard.press('Tab');
        await page.evaluate(() => document.activeElement?.setAttribute('data-qa-seen', '1'));
      }
      const reached = await page.evaluate(() => document.querySelectorAll('[data-qa-seen]').length);
      expect(reached, `Tab reached ${reached} of ${total} interactive elements`).toBeGreaterThanOrEqual(total);
    });

    test('keyboard: clickable elements are real buttons or links', async ({ page }) => {
      test.skip(!enabled('a11y'), 'accessibility checks switched off in qa.config.json');
      await page.goto(p);
      await settle(page);
      expect(await mouseOnlyControls(page), 'elements that react to clicks but cannot be focused').toEqual([]);
    });
  });
}
