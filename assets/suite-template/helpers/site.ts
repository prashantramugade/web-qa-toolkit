import fs from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';

export interface ExploredField { key: string; tag: string; type: string; name: string; id: string; label: string; placeholder: string; required: boolean; min: string; max: string; maxlength: number; options: number }
export interface ExploredForm { path: string; index: number; method: string; submitText: string; hasPassword: boolean; fields: ExploredField[] }
export interface ExploredSearch { path: string; action: string; param: string; term: string }
export interface ExploredControl { path: string; text: string; hasQty: boolean }
export interface QaConfig {
  baseURL: string;
  pages: string[];
  skipChecks?: string[];
  ignoreFailedRequests?: string[];
  ignoreConsole?: string[];
  explored?: { forms: ExploredForm[]; searches: ExploredSearch[]; controls: ExploredControl[] };
}

// qa.config.json is written by scripts/scaffold-suite.mjs from the crawl and the exploration.
export const cfg: QaConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../qa.config.json'), 'utf8'));
export const explored = cfg.explored ?? { forms: [], searches: [], controls: [] };

/** Turn a check off in qa.config.json ("skipChecks": ["seo"]). Use it to remove noise, never to hide defects. */
export const enabled = (name: string) => !(cfg.skipChecks ?? []).includes(name);

/** Tests that submit data only run when you opt in, against a test environment: ALLOW_WRITES=1 */
export const allowWrites = process.env.ALLOW_WRITES === '1';

export const ignoreFailed = (url: string) => (cfg.ignoreFailedRequests ?? []).some(r => new RegExp(r, 'i').test(url));
export const ignoreConsole = (text: string) => (cfg.ignoreConsole ?? []).some(r => new RegExp(r, 'i').test(text));

/** Wait until the page is a settled state a user would actually look at. */
export async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
}

/** Block every write request in the browser (nothing leaves the machine). Returns the list of attempts. */
export async function blockWrites(page: Page) {
  const attempts: string[] = [];
  await page.route('**/*', route => {
    const req = route.request();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
      attempts.push(`${req.method()} ${req.url()}`);
      return req.resourceType() === 'document' ? route.fulfill({ status: 204, body: '' }) : route.abort('failed');
    }
    return route.continue();
  });
  return attempts;
}
