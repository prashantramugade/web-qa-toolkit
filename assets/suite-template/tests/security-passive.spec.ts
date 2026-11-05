import { test, expect } from '@playwright/test';
import { cfg, enabled, settle } from '../helpers/site';

// Passive checks only: they read headers, cookies and markup. Nothing here probes or attacks the site.
for (const p of cfg.pages) {
  test.describe(p, () => {
    test('security: baseline response headers (https only)', async ({ request, baseURL }) => {
      test.skip(!enabled('security'), 'security checks switched off in qa.config.json');
      test.skip(!baseURL?.startsWith('https:'), 'headers are checked on https targets only');
      const h = (await request.get(p)).headers();
      const missing = ['strict-transport-security', 'x-content-type-options', 'content-security-policy', 'referrer-policy'].filter(n => !h[n]);
      expect(missing, 'missing response headers').toEqual([]);
    });

    test('security: session-like cookies are HttpOnly', async ({ page, context }) => {
      test.skip(!enabled('security'), 'security checks switched off in qa.config.json');
      await page.goto(p);
      await settle(page);
      const weak = (await context.cookies()).filter(c => /sess|auth|token|sid|jwt/i.test(c.name) && !c.httpOnly).map(c => c.name);
      expect(weak, 'session-like cookies readable by JavaScript').toEqual([]);
    });

    test('security: no mixed content on https pages', async ({ page, baseURL }) => {
      test.skip(!enabled('security'), 'security checks switched off in qa.config.json');
      test.skip(!baseURL?.startsWith('https:'), 'mixed content only applies to https targets');
      const insecure: string[] = [];
      page.on('request', r => { if (r.url().startsWith('http:')) insecure.push(r.url()); });
      await page.goto(p);
      await settle(page);
      expect(insecure, 'http:// requests made by an https page').toEqual([]);
    });
  });
}
