import { test, expect } from '@playwright/test';
import { explored, enabled, settle } from '../../helpers/site';
import { counterDelta } from '../../helpers/observe';

// Buttons that sit next to a quantity field (add to cart and similar). Generated from exploration.
// Clicking them only changes client-side state in most apps; add ALLOW_WRITES guards yourself if yours calls an API.
const withQty = explored.controls.filter(c => c.hasQty);

for (const c of withQty) {
  test.describe(`${c.path} "${c.text}"`, () => {
    test.skip(!enabled('functional'), 'functional checks switched off in qa.config.json');

    const quantityInput = (page: import('@playwright/test').Page) => {
      const button = page.getByRole('button', { name: c.text }).first();
      return { button, qty: button.locator('xpath=ancestor::*[.//input[@type="number"]][1]//input[@type="number"]').first() };
    };

    for (const n of [1, 2, 5]) {
      test(`quantity ${n} changes the counter by ${n}`, async ({ page }) => {
        await page.goto(c.path);
        await settle(page);
        const { button, qty } = quantityInput(page);
        await qty.fill(String(n));
        const delta = await counterDelta(page, () => button.click());
        test.skip(delta === null, 'no cart or item counter was found on the page');
        expect(delta, `counter changed by ${delta} after adding ${n}`).toBe(n);
      });
    }

    for (const n of [0, -1]) {
      test(`quantity ${n} is rejected`, async ({ page }) => {
        await page.goto(c.path);
        await settle(page);
        const { button, qty } = quantityInput(page);
        await qty.fill(String(n));
        const delta = await counterDelta(page, () => button.click());
        test.skip(delta === null, 'no cart or item counter was found on the page');
        expect(delta, `counter changed by ${delta} for quantity ${n}`).toBe(0);
      });
    }
  });
}
