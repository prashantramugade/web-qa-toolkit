/**
 * Input matrices for form tests: equivalence classes and boundary values.
 * Realistic, non-destructive values only. Attack payloads are out of scope.
 */
import type { ExploredField } from './site';

export const emailCases = {
  valid: ['user@example.com', 'first.last+tag@sub.example.co.uk'],
  invalid: ['plainaddress', 'missing-at.example.com', 'user@', '@example.com', 'user @example.com', 'user@@example.com'],
};

export const textCases = {
  empty: '',
  whitespaceOnly: '   ',
  padded: '  padded  ',
  long256: 'x'.repeat(256),
  long5000: 'x'.repeat(5000),
  unicode: 'Zoë Müller 你好 😀',
  quotes: `O'Brien & "Sons" <Ltd>`,
};

export const numberCases = { zero: '0', negative: '-1', decimal: '1.5', huge: '9999999999' };

export const passwordCases = { tooShort: 'a1', noDigits: 'abcdefgh', common: 'password', longValid: 'Corr3ct-Horse-Battery-Staple!' };

/** A value that should be accepted for this field. */
export function validValue(f: ExploredField): string {
  const hint = `${f.name} ${f.id} ${f.label} ${f.placeholder}`.toLowerCase();
  if (f.type === 'email' || /e-?mail/.test(hint)) return emailCases.valid[0];
  if (f.type === 'tel' || /phone|tel\b/.test(hint)) return '+31 20 123 4567';
  if (f.type === 'url') return 'https://example.com';
  if (f.type === 'number') return String(Math.max(1, Number(f.min || 1)));
  if (f.type === 'date') return new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  if (/name/.test(hint)) return 'QA Tester';
  if (f.tag === 'textarea' || /message|comment|description|note/.test(hint)) return 'QA exploratory test message. Please ignore.';
  return 'QA test';
}

/** What feedback text usually looks like. */
export const SUCCESS = /thank|success|\bsent\b|received|submitted|saved|subscribed|we will (reply|contact|get back)|message has been/i;
export const ERROR = /error|invalid|required|please (enter|provide|fill|select|check)|\bmust\b|cannot|can't|too (short|long)|not valid|incorrect|missing/i;
export const EMPTY_STATE = /no (results|products|items|matches|records)|nothing (found|matched)|0 results|did(n't| not) find|not found|no .* found/i;
