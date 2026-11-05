import type { Page } from '@playwright/test';

/** Everything a user can read on the page, one entry per line. */
export async function lines(page: Page): Promise<string[]> {
  return page.evaluate(() => (document.body.innerText || '').split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 400));
}

/** The number that belongs to a counter label such as "Cart: 3" or "3 items". */
export function cartNumber(line?: string): number | null {
  const m = /(?:cart|basket|bag|items?|qty|quantity|count)\D{0,12}(-?\d+(?:\.\d+)?)/i.exec(line ?? '') || /(-?\d+(?:\.\d+)?)\s*(?:items?|in (?:your )?cart)/i.exec(line ?? '');
  return m ? Number(m[1]) : null;
}

/** Run an action and report how a counter-like line (cart, basket, items) changed. null = no counter found. */
export async function counterDelta(page: Page, action: () => Promise<void>): Promise<number | null> {
  const before = await lines(page);
  await action();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);
  const after = await lines(page);
  const cartish = (l: string) => /cart|basket|bag|items?|qty|quantity|count/i.test(l);
  const now = after.filter(l => !before.includes(l)).find(cartish);
  const was = before.filter(l => !after.includes(l)).find(cartish);
  const n = cartNumber(now);
  return n === null ? null : n - (cartNumber(was) ?? 0);
}

/** Elements that react to clicks but are not buttons or links and cannot be reached with the keyboard. */
export async function mouseOnlyControls(page: Page) {
  return page.evaluate(() => {
    const vis = (e: Element) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const native = ['a', 'button', 'input', 'select', 'textarea', 'summary', 'label', 'option'];
    return [...document.querySelectorAll('body *')].filter(e => {
      const tag = e.tagName.toLowerCase();
      if (!vis(e) || native.includes(tag) || e.hasAttribute('tabindex') || ['button', 'link', 'menuitem', 'tab', 'checkbox', 'switch'].includes(e.getAttribute('role') ?? '')) return false;
      if (e.closest('a,button,[tabindex],[role=button],[role=link]')) return false;
      const own = getComputedStyle(e).cursor === 'pointer';
      const parent = e.parentElement && getComputedStyle(e.parentElement).cursor === 'pointer';
      return e.hasAttribute('onclick') || (own && !parent && ['div', 'span', 'li', 'img', 'p'].includes(tag));
    }).slice(0, 6).map(e => `<${e.tagName.toLowerCase()}> ${((e as HTMLElement).innerText || '').trim().slice(0, 40)}`);
  });
}
