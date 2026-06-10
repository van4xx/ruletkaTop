import { createHash } from 'node:crypto';

import { signTbankToken, verifyTbankToken } from './tbank-signature';

/**
 * Self-checking fixture for the T-Bank Token algorithm.
 *
 * We DERIVE the expected hex with Node's `crypto` at spec time rather than
 * hard-coding a magic value, so the spec verifies the IMPLEMENTATION uses the
 * documented algorithm (concat sorted values + SHA-256 hex lower) instead of
 * just matching itself. If the implementation diverges from the docs, this
 * spec catches it.
 */
describe('signTbankToken — documented algorithm fixture', () => {
  const password = 'usaf8fw8fsw21g';

  it('hashes a representative Init payload exactly per the T-Bank docs', () => {
    const payload = {
      TerminalKey: '1321054611DEMO',
      Amount: 19200,
      OrderId: '21090',
      Description: 'Подарочная карта на 1257 рублей',
    };
    // The docs say: sort BY KEY, concat VALUES, SHA-256 hex lower. With
    // Password injected:
    //   keys sorted asc: Amount, Description, OrderId, Password, TerminalKey
    //   values:          19200 + "Подарочная …" + "21090" + password + "1321054611DEMO"
    const sortedValues = '19200' + 'Подарочная карта на 1257 рублей' + '21090' + password + '1321054611DEMO';
    const expected = createHash('sha256').update(sortedValues, 'utf8').digest('hex');
    expect(signTbankToken(payload, password)).toBe(expected);
  });

  it('EXCLUDES the Token field itself (idempotent on a re-signed payload)', () => {
    const payload = { TerminalKey: 'TK', OrderId: 'O1', Amount: 100 };
    const token1 = signTbankToken(payload, password);
    const token2 = signTbankToken({ ...payload, Token: token1 }, password);
    expect(token2).toBe(token1);
  });

  it('EXCLUDES nested objects (Receipt / DATA) — only root scalars sign', () => {
    const payload = {
      TerminalKey: 'TK',
      OrderId: 'O1',
      Amount: 100,
      // DATA is a flat map per T-Bank docs but IS still nested → not signed.
      DATA: { purpose: 'coins', userId: 'u1' },
      // Receipt is a nested object → not signed.
      Receipt: { Email: 'a@b.c', Items: [] },
    };
    const expected = signTbankToken(
      { TerminalKey: 'TK', OrderId: 'O1', Amount: 100 },
      password,
    );
    expect(signTbankToken(payload, password)).toBe(expected);
  });

  it('signs booleans as `true` / `false` (matching the webhook Success field)', () => {
    const trueHash = signTbankToken({ A: true }, '');
    const falseHash = signTbankToken({ A: false }, '');
    expect(trueHash).toBe(createHash('sha256').update('true', 'utf8').digest('hex'));
    expect(falseHash).toBe(createHash('sha256').update('false', 'utf8').digest('hex'));
  });

  it('returns SHA-256 of the password alone for an empty payload', () => {
    expect(signTbankToken({}, password)).toBe(
      createHash('sha256').update(password, 'utf8').digest('hex'),
    );
  });
});

describe('verifyTbankToken — webhook verification', () => {
  const password = 'wh-pwd';

  function notification(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const base = {
      TerminalKey: 'TK',
      OrderId: 'order-1',
      Success: true,
      Status: 'CONFIRMED',
      PaymentId: '999',
      Amount: 19900,
      Token: '',
      ...overrides,
    };
    base.Token = signTbankToken(base, password);
    return base;
  }

  it('accepts a notification whose Token matches the recomputed digest', () => {
    expect(verifyTbankToken(notification(), password)).toBe(true);
  });

  it('rejects a tampered Amount even with the original Token', () => {
    const n = notification();
    n.Amount = 1; // tamper after signing
    expect(verifyTbankToken(n, password)).toBe(false);
  });

  it('rejects a missing Token', () => {
    const n = notification();
    delete (n as Record<string, unknown>).Token;
    expect(verifyTbankToken(n, password)).toBe(false);
  });

  it('rejects a signature made with the wrong password', () => {
    const n = notification();
    expect(verifyTbankToken(n, 'wrong-password')).toBe(false);
  });

  it('IGNORES nested Receipt / DATA on verify (mirrors sign behaviour)', () => {
    const n = notification();
    // Adding nested fields AFTER signing must not break verification.
    (n as Record<string, unknown>).Receipt = { Items: [{ Name: 'x' }] };
    (n as Record<string, unknown>).DATA = { userId: 'u1' };
    expect(verifyTbankToken(n, password)).toBe(true);
  });
});
