import { Page } from '@playwright/test';
import { BasePage } from './BasePage';
import { ExploredForm, ExploredField } from '../helpers/site';
import { validValue, SUCCESS, ERROR } from '../helpers/form-data';

export interface Outcome { writes: number; accepted: boolean; feedback: string; htmlInvalid: string[] }

/**
 * Page object for any form found during exploration.
 * Fields are addressed by name/id because this file is generic: when you write a test for a specific page,
 * use getByLabel instead (see tests/functional/_template.spec.ts.txt).
 */
export class FormPage extends BasePage {
  readonly path: string;
  constructor(page: Page, private readonly form: ExploredForm) { super(page); this.path = form.path; }

  private get root() { return this.page.locator('form').nth(this.form.index); }
  private field(f: ExploredField) {
    const sel = f.id ? `#${f.id}` : `[name="${f.name}"]`;
    return this.root.locator(sel).first();
  }

  async open() { await this.goto(); }

  async fill(values: Record<string, string> = {}) {
    for (const f of this.form.fields) {
      const v = values[f.key];
      const loc = this.field(f);
      if (f.tag === 'select') await loc.selectOption({ index: f.options > 1 ? 1 : 0 }).catch(() => {});
      else if (f.type === 'checkbox' || f.type === 'radio') { if (v !== '' && v !== undefined) await loc.check().catch(() => {}); }
      else await loc.fill(v ?? '').catch(() => {});
    }
  }

  /** All fields valid, optionally overriding some. */
  valid(overrides: Record<string, string> = {}) {
    return { ...Object.fromEntries(this.form.fields.map(f => [f.key, validValue(f)])), ...overrides };
  }

  /**
   * Submit and describe what a user would observe.
   * Call blockWrites(page) first to make this safe on any environment: the request is then counted but never sent.
   */
  async submit(): Promise<Outcome> {
    let writes = 0;
    const count = (r: { method(): string }) => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method())) writes++; };
    this.page.on('request', count);
    const before = await this.page.evaluate(() => (document.body.innerText || '').split('\n').map(s => s.trim()).filter(Boolean));
    const button = this.root.locator('button:not([type=button]):not([type=reset]), input[type=submit]').first();
    if (await button.count()) await button.click(); else await this.root.locator('input,textarea').last().press('Enter');
    await this.page.waitForLoadState('networkidle').catch(() => {});
    await this.page.waitForTimeout(400);
    this.page.off('request', count);
    const after = await this.page.evaluate(() => (document.body.innerText || '').split('\n').map(s => s.trim()).filter(Boolean));
    const invalid = await this.page.evaluate(() => [...document.querySelectorAll('input,select,textarea')]
      .filter((e: any) => e.willValidate && !e.validity.valid).map((e: any) => `${e.name || e.id}: ${e.validationMessage}`));
    const feedback = after.filter(l => !before.includes(l)).join(' | ');
    const errorLike = ERROR.test(feedback) || invalid.length > 0;
    const accepted = (SUCCESS.test(feedback) && !errorLike) || (writes > 0 && !errorLike);
    return { writes, accepted, feedback, htmlInvalid: invalid };
  }
}
