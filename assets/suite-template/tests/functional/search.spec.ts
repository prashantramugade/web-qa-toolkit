import { test, expect } from '@playwright/test';
import { explored, enabled, settle } from '../../helpers/site';
import { lines } from '../../helpers/observe';
import { EMPTY_STATE } from '../../helpers/form-data';

// Search forms use GET, so these tests are safe on any environment.
const STACK = /traceback|stack trace|at .+\(.+:\d+:\d+\)|sqlstate|exception in|syntax error near/i;

for (const s of explored.searches) {
  const url = (value: string) => `${s.action}?${encodeURIComponent(s.param)}=${encodeURIComponent(value)}`;
  const text = async (page: import('@playwright/test').Page) => (await lines(page)).join(' ');

  test.describe(`${s.path} search (${s.param})`, () => {
    test.skip(!enabled('functional'), 'functional checks switched off in qa.config.json');

    for (const [name, value] of [['empty', ''], ['special characters', `%&"'<>`], ['300 characters', 'a'.repeat(300)]]) {
      test(`${name} query does not break the page`, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', e => errors.push(e.message));
        const resp = await page.goto(url(value));
        await settle(page);
        expect(resp?.status(), 'HTTP status').toBeLessThan(500);
        expect(STACK.test(await text(page)), 'stack trace visible').toBe(false);
        expect(errors, 'script errors').toEqual([]);
      });
    }

    test('a query with no matches shows a helpful empty state', async ({ page }) => {
      await page.goto(url('zzqa-no-such-item-xyz'));
      await settle(page);
      expect(EMPTY_STATE.test(await text(page)), 'page says nothing was found').toBe(true);
    });

    if (s.term) {
      test(`search ignores letter case ("${s.term}")`, async ({ page }) => {
        await page.goto(url(s.term));
        await settle(page);
        const exactEmpty = EMPTY_STATE.test(await text(page));
        test.skip(exactEmpty, `"${s.term}" has no results to compare against`);
        for (const variant of [s.term.toLowerCase(), s.term.toUpperCase()]) {
          await page.goto(url(variant));
          await settle(page);
          expect(EMPTY_STATE.test(await text(page)), `"${variant}" shows the empty state but "${s.term}" does not`).toBe(false);
        }
      });
    }
  });
}
