import { Page, expect } from '@playwright/test';

/**
 * Base class for page objects. Prefer role and label locators: they double as accessibility checks.
 * If a control can only be found with getByPlaceholder or CSS, it has no accessible name: report that.
 */
export abstract class BasePage {
  constructor(protected readonly page: Page) {}
  abstract readonly path: string;

  async goto() {
    const resp = await this.page.goto(this.path);
    expect(resp?.status(), `${this.path} should load`).toBeLessThan(400);
    await this.page.waitForLoadState('networkidle').catch(() => {});
  }
  nav(name: string | RegExp) { return this.page.getByRole('navigation').getByRole('link', { name }); }
  heading(name: string | RegExp) { return this.page.getByRole('heading', { name }); }
}
