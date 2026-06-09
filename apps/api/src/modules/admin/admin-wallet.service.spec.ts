import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

import type { Connection } from 'mongoose';

import { InsufficientFundsException } from '../wallet/insufficient-funds.exception';
import type { WalletService } from '../wallet/wallet.service';
import { AdminWalletService } from './admin-wallet.service';

const USER_A = '507f1f77bcf86cd7994390a1';
const USER_B = '507f1f77bcf86cd7994390a2';

/**
 * A faithful in-memory stand-in for {@link WalletService} that REPRODUCES the
 * ledger's `(type, refId)` idempotency. This is what makes these tests adversarial:
 * a credit/debit whose `(type, refId)` was already seen is treated as "already
 * applied" and self-compensates to the SAME balance (mirroring the real service's
 * append-ledger → dup-key → compensate path). So a constant refId would silently
 * no-op the 2nd+ same-sign adjustment — exactly the bug under test — while a
 * per-adjustment unique refId always moves the balance.
 */
function makeWalletStub(initialBalances: Record<string, number> = {}) {
  const balances = new Map<string, number>(Object.entries(initialBalances));
  const seenRefs = new Set<string>();

  const balanceOf = (userId: string): number => balances.get(userId) ?? 0;

  const credit = jest.fn(
    async (userId: string, coins: number, type: string, refId: string | null): Promise<number> => {
      const key = refId === null ? null : `${type}:${refId}`;
      if (key !== null && seenRefs.has(key)) {
        // Duplicate ledger key ⇒ already applied ⇒ no net balance change.
        return balanceOf(userId);
      }
      if (key !== null) seenRefs.add(key);
      const next = balanceOf(userId) + coins;
      balances.set(userId, next);
      return next;
    },
  );

  const debit = jest.fn(
    async (userId: string, coins: number, type: string, refId: string | null): Promise<number> => {
      if (balanceOf(userId) < coins) {
        throw new InsufficientFundsException();
      }
      const key = refId === null ? null : `${type}:${refId}`;
      if (key !== null && seenRefs.has(key)) {
        return balanceOf(userId);
      }
      if (key !== null) seenRefs.add(key);
      const next = balanceOf(userId) - coins;
      balances.set(userId, next);
      return next;
    },
  );

  const getBalance = jest.fn(async (userId: string) => balanceOf(userId));

  const walletService = { credit, debit, getBalance } as unknown as WalletService;
  return { walletService, credit, debit, balanceOf };
}

/** A bare connection stub — `adjust` never touches it. */
function connectionStub(): Connection {
  return { collection: jest.fn() } as unknown as Connection;
}

function makeService(initialBalances: Record<string, number> = {}) {
  const wallet = makeWalletStub(initialBalances);
  const service = new AdminWalletService(wallet.walletService, connectionStub());
  return { service, ...wallet };
}

describe('AdminWalletService.adjust', () => {
  it('applies TWO successive credits to the same user — both move the balance (no silent no-op)', async () => {
    // Regression: a constant refId collided on the ledger's (type, refId) index,
    // so the 2nd same-sign adjustment self-compensated and silently no-op'd.
    const { service, credit, balanceOf } = makeService({ [USER_A]: 0 });

    const first = await service.adjust(USER_A, 100, 'top-up #1');
    const second = await service.adjust(USER_A, 50, 'top-up #2');

    expect(first.balanceCoins).toBe(100);
    expect(second.balanceCoins).toBe(150); // would be 100 (no-op) under the bug
    expect(balanceOf(USER_A)).toBe(150);
    expect(first).toEqual({ userId: USER_A, balanceCoins: 100, delta: 100 });
    expect(second).toEqual({ userId: USER_A, balanceCoins: 150, delta: 50 });

    // Each adjustment must carry a DISTINCT, globally-unique refId (the fix).
    const refs = credit.mock.calls.map((c) => c[3] as string);
    expect(refs).toHaveLength(2);
    expect(new Set(refs).size).toBe(2);
    refs.forEach((ref) => expect(ref).toMatch(new RegExp(`^admin-adjust:${USER_A}:[0-9a-f]{24}$`)));
  });

  it('applies TWO successive debits to the same user — both move the balance', async () => {
    const { service, debit, balanceOf } = makeService({ [USER_A]: 500 });

    const first = await service.adjust(USER_A, -100, 'clawback #1');
    const second = await service.adjust(USER_A, -50, 'clawback #2');

    expect(first.balanceCoins).toBe(400);
    expect(second.balanceCoins).toBe(350); // would be 400 (no-op) under the bug
    expect(balanceOf(USER_A)).toBe(350);

    const refs = debit.mock.calls.map((c) => c[3] as string);
    expect(new Set(refs).size).toBe(2);
  });

  it('applies adjustments to TWO different users independently', async () => {
    const { service, balanceOf } = makeService({ [USER_A]: 0, [USER_B]: 0 });

    const a = await service.adjust(USER_A, 100, 'grant A');
    const b = await service.adjust(USER_B, 75, 'grant B');

    expect(a.balanceCoins).toBe(100);
    expect(b.balanceCoins).toBe(75);
    expect(balanceOf(USER_A)).toBe(100);
    expect(balanceOf(USER_B)).toBe(75);
  });

  it('routes a positive amount through credit (bonus) and a negative through debit (refund)', async () => {
    const { service, credit, debit } = makeService({ [USER_A]: 200 });

    await service.adjust(USER_A, 30, 'bonus');
    await service.adjust(USER_A, -20, 'clawback');

    expect(credit).toHaveBeenCalledWith(USER_A, 30, 'bonus', expect.any(String));
    expect(debit).toHaveBeenCalledWith(USER_A, 20, 'refund', expect.any(String));
  });

  it('throws 422 (InsufficientFunds) when a debit exceeds the balance', async () => {
    const { service } = makeService({ [USER_A]: 10 });

    await expect(service.adjust(USER_A, -100, 'over-debit')).rejects.toBeInstanceOf(
      InsufficientFundsException,
    );
  });

  it('throws 400 for a zero amount', async () => {
    const { service, credit, debit } = makeService({ [USER_A]: 0 });

    await expect(service.adjust(USER_A, 0, 'noop')).rejects.toBeInstanceOf(BadRequestException);
    expect(credit).not.toHaveBeenCalled();
    expect(debit).not.toHaveBeenCalled();
  });

  it('throws 400 for a non-integer amount', async () => {
    const { service, credit, debit } = makeService({ [USER_A]: 0 });

    await expect(service.adjust(USER_A, 12.5, 'fractional')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(credit).not.toHaveBeenCalled();
    expect(debit).not.toHaveBeenCalled();
  });

  it('throws 404 for an invalid userId (before touching the wallet)', async () => {
    const { service, credit, debit } = makeService();

    await expect(service.adjust('not-an-objectid', 100, 'bad id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(credit).not.toHaveBeenCalled();
    expect(debit).not.toHaveBeenCalled();
  });

  it('mints a valid ObjectId-suffixed refId per adjustment', async () => {
    const { service, credit } = makeService({ [USER_A]: 0 });

    await service.adjust(USER_A, 100, 'check ref shape');

    const ref = credit.mock.calls[0]![3] as string;
    const [prefix, uid, oid] = ref.split(':');
    expect(prefix).toBe('admin-adjust');
    expect(uid).toBe(USER_A);
    expect(Types.ObjectId.isValid(oid!)).toBe(true);
  });
});
