import { test, expect } from '@playwright/test';
import { explored, enabled, allowWrites, blockWrites } from '../../helpers/site';
import { emailCases, textCases } from '../../helpers/form-data';
import { FormPage } from '../../pages/FormPage';

// Generated from the forms exploration found. Each test changes ONE thing and checks what a user would observe.
// Cases that only look at client-side validation use blockWrites(): nothing is ever sent, so they are safe on any environment.
// Cases that really submit run only with ALLOW_WRITES=1 against a test environment.
const forms = explored.forms.filter(f => !f.hasPassword); // login forms are never filled by the toolkit

for (const f of forms) {
  test.describe(`${f.path} form #${f.index}`, () => {
    test.skip(!enabled('functional'), 'functional checks switched off in qa.config.json');

    test('an empty submission is not accepted', async ({ page }) => {
      const attempts = await blockWrites(page);
      const form = new FormPage(page, f);
      await form.open();
      await form.fill({});
      const outcome = await form.submit();
      expect(outcome.accepted, `empty form was accepted (${attempts.length} write request(s) attempted, feedback: "${outcome.feedback}")`).toBe(false);
    });

    for (const field of f.fields.filter(x => x.type === 'email' || /e-?mail/i.test(`${x.name} ${x.id} ${x.placeholder}`))) {
      for (const bad of emailCases.invalid.slice(0, 2)) {
        test(`invalid email "${bad}" in ${field.name || field.id} is not accepted`, async ({ page }) => {
          const attempts = await blockWrites(page);
          const form = new FormPage(page, f);
          await form.open();
          await form.fill(form.valid({ [field.key]: bad }));
          const outcome = await form.submit();
          expect(outcome.accepted, `"${bad}" was accepted (${attempts.length} write request(s) attempted)`).toBe(false);
        });
      }
    }

    const firstText = f.fields.find(x => ['text', 'search', ''].includes(x.type) && x.tag === 'input');
    if (firstText) {
      test(`only spaces in ${firstText.name || firstText.id} is not accepted`, async ({ page }) => {
        const attempts = await blockWrites(page);
        const form = new FormPage(page, f);
        await form.open();
        await form.fill(form.valid({ [firstText.key]: textCases.whitespaceOnly }));
        const outcome = await form.submit();
        expect(outcome.accepted, `whitespace was accepted (${attempts.length} write request(s) attempted)`).toBe(false);
      });
    }

    test('a valid submission is accepted with a clear confirmation', async ({ page }) => {
      test.skip(!allowWrites, 'this test submits data: set ALLOW_WRITES=1 and run it against a test environment');
      const form = new FormPage(page, f);
      await form.open();
      await form.fill(form.valid());
      const outcome = await form.submit();
      expect(outcome.accepted, `valid input was not accepted (feedback: "${outcome.feedback}")`).toBe(true);
    });

    test('unicode and punctuation are accepted', async ({ page }) => {
      test.skip(!allowWrites, 'this test submits data: set ALLOW_WRITES=1 and run it against a test environment');
      const textField = f.fields.find(x => x.tag === 'textarea' || ['text', ''].includes(x.type));
      test.skip(!textField, 'form has no free-text field');
      const form = new FormPage(page, f);
      await form.open();
      await form.fill(form.valid({ [textField!.key]: `${textCases.unicode} ${textCases.quotes}` }));
      const outcome = await form.submit();
      expect(outcome.accepted, `awkward but legitimate text was rejected (feedback: "${outcome.feedback}")`).toBe(true);
    });
  });
}
