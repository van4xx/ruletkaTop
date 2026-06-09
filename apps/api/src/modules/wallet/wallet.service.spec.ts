import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { coinTxTypeSchema } from '@ruletka/shared-types';
import { model, Types } from 'mongoose';

import { CoinTransaction, CoinTransactionSchema } from './schemas/coin-transaction.schema';
import { Wallet } from './schemas/wallet.schema';
import { EconomyHoldException } from './economy-hold.exception';
import { InsufficientFundsException } from './insufficient-funds.exception';
import { WalletService } from './wallet.service';

/**
 * Builds a chainable Mongoose query stub whose terminal `.exec()` resolves to
 * `result`. Records the args the query method was called with for assertions.
 */
function queryReturning(result: unknown): { exec: jest.Mock } {
  return { exec: jest.fn().mockResolvedValue(result) };
}

describe('WalletService — debit atomicity & insufficient funds', () => {
  // 24-hex ObjectId string for a valid `userId`.
  const userId = '507f1f77bcf86cd799439011';

  let service: WalletService;
  let walletModel: { findOneAndUpdate: jest.Mock; findOne: jest.Mock };
  let coinTxModel: { create: jest.Mock };

  beforeEach(async () => {
    walletModel = {
      findOneAndUpdate: jest.fn(),
      // Default: a NON-held wallet, so the economy-hold read-helpers (isOnHold on
      // a debit non-match, maybeReleaseHold after a credit) are safe no-ops here.
      // Tests that exercise getBalance override this with their own chain stub.
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({ economyHold: false, heldCoins: 0 }),
      }),
    };
    coinTxModel = {
      create: jest.fn().mockResolvedValue([{ _id: 'tx1' }]),
    };

    // Force the standalone-Mongo path: startSession throws the "not a replica
    // set" error so `runWalletWrite` falls back to sequential atomic writes
    // (the realistic dev scenario) — keeps the test deterministic and asserts
    // the fallback preserves the overdraft guard.
    const connection = {
      startSession: jest.fn().mockRejectedValue(
        Object.assign(new Error('Transaction numbers are only allowed on a replica set'), {
          code: 20,
        }),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: getModelToken(Wallet.name), useValue: walletModel },
        { provide: getModelToken(CoinTransaction.name), useValue: coinTxModel },
        { provide: getConnectionToken(), useValue: connection },
      ],
    }).compile();

    service = moduleRef.get(WalletService);
  });

  it('debits with a balance-guarded atomic update and appends a ledger row', async () => {
    // Wallet had 100; after debiting 30 the guarded update returns balance 70.
    walletModel.findOneAndUpdate.mockReturnValue(queryReturning({ balanceCoins: 70 }));

    const newBalance = await service.debit(userId, 30, 'gift_out', 'gift-1');

    expect(newBalance).toBe(70);

    // The guard MUST require balanceCoins >= coins and decrement by exactly coins.
    const [filter, update] = walletModel.findOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(filter).toMatchObject({ balanceCoins: { $gte: 30 } });
    expect(update).toEqual({ $inc: { balanceCoins: -30 } });

    // A single immutable ledger row with the signed delta + post-balance.
    expect(coinTxModel.create).toHaveBeenCalledTimes(1);
    const [[row]] = coinTxModel.create.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(row).toMatchObject({
      delta: -30,
      type: 'gift_out',
      refId: 'gift-1',
      balanceAfter: 70,
    });
  });

  it('throws InsufficientFundsException (422) and writes NO ledger row when the guarded update matches nothing', async () => {
    // Guarded update matches no document ⇒ balance was below the requested amount.
    walletModel.findOneAndUpdate.mockReturnValue(queryReturning(null));

    await expect(service.debit(userId, 1000, 'top', 'top-1')).rejects.toBeInstanceOf(
      InsufficientFundsException,
    );

    const err = await service.debit(userId, 1000, 'top', 'top-1').catch((e: unknown) => e);
    expect((err as InsufficientFundsException).getStatus()).toBe(422);

    // Critically: no balance was moved AND no ledger row was written.
    expect(coinTxModel.create).not.toHaveBeenCalled();
  });

  it('rejects non-positive / non-integer debit amounts without touching the wallet', async () => {
    await expect(service.debit(userId, 0, 'top', null)).rejects.toBeInstanceOf(
      InsufficientFundsException,
    );
    await expect(service.debit(userId, -5, 'top', null)).rejects.toBeInstanceOf(
      InsufficientFundsException,
    );
    await expect(service.debit(userId, 2.5, 'top', null)).rejects.toBeInstanceOf(
      InsufficientFundsException,
    );
    expect(walletModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(coinTxModel.create).not.toHaveBeenCalled();
  });

  it('credits with an upserting atomic increment and a positive ledger row', async () => {
    walletModel.findOneAndUpdate.mockReturnValue(queryReturning({ balanceCoins: 130 }));

    const newBalance = await service.credit(userId, 30, 'purchase', 'inv-1');

    expect(newBalance).toBe(130);
    const [, update, options] = walletModel.findOneAndUpdate.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(update).toMatchObject({ $inc: { balanceCoins: 30 } });
    expect(options).toMatchObject({ upsert: true });

    const [[row]] = coinTxModel.create.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(row).toMatchObject({ delta: 30, type: 'purchase', balanceAfter: 130 });
  });

  it('reports the balance via getBalance (0 when no wallet exists)', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    };
    walletModel.findOne.mockReturnValue(chain);

    await expect(service.getBalance(userId)).resolves.toBe(0);
  });

  it('credits AT MOST ONCE per refId: a duplicate ledger row (redelivery) is compensated, not double-credited', async () => {
    // P0 idempotency: a redelivered CloudPayments Pay (or a rolled-back-then-
    // retried fulfilment) re-invokes credit() with the SAME (type, refId). The
    // first credit appends the ledger row; the second hits the unique
    // `(type, refId)` partial index and throws E11000 — we must then UNDO the
    // speculative balance $inc so the coins are credited exactly once.
    //
    // Call 1: $inc → 600, ledger insert succeeds.
    // Call 2: $inc → 1200 (speculative), ledger insert dup-keys, compensating
    //         $inc(-600) → 600. Net: balance stays 600.
    walletModel.findOneAndUpdate
      .mockReturnValueOnce(queryReturning({ balanceCoins: 600 })) // call 1 credit
      .mockReturnValueOnce(queryReturning({ balanceCoins: 1200 })) // call 2 speculative credit
      .mockReturnValueOnce(queryReturning({ balanceCoins: 600 })); // call 2 compensation

    coinTxModel.create
      .mockResolvedValueOnce([{ _id: 'tx1' }])
      .mockRejectedValueOnce(
        Object.assign(new Error('E11000 duplicate key error'), { code: 11000 }),
      );

    const first = await service.credit(userId, 600, 'purchase', 'inv-dup');
    const second = await service.credit(userId, 600, 'purchase', 'inv-dup');

    expect(first).toBe(600);
    // The duplicate delivery returns the UNCHANGED balance (no second credit).
    expect(second).toBe(600);

    // Exactly one ledger row was actually written; the dup attempt was caught.
    expect(coinTxModel.create).toHaveBeenCalledTimes(2);
    // The compensating $inc reverses the speculative credit by exactly -600.
    const compensation = walletModel.findOneAndUpdate.mock.calls[2] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(compensation[1]).toEqual({ $inc: { balanceCoins: -600 } });
  });

  it('debits AT MOST ONCE per refId: a duplicate refund ledger row is compensated, not double-debited', async () => {
    // A redelivered Refund webhook reverses the same invoice twice. The guarded
    // debit subtracts speculatively, the dup ledger insert is caught, and the
    // compensating $inc adds the coins back so the debit happens once.
    walletModel.findOneAndUpdate
      .mockReturnValueOnce(queryReturning({ balanceCoins: 400 })) // call 1 debit (1000-600)
      .mockReturnValueOnce(queryReturning({ balanceCoins: -200 })) // call 2 speculative debit
      .mockReturnValueOnce(queryReturning({ balanceCoins: 400 })); // call 2 compensation

    coinTxModel.create
      .mockResolvedValueOnce([{ _id: 'tx1' }])
      .mockRejectedValueOnce(
        Object.assign(new Error('E11000 duplicate key error'), { code: 11000 }),
      );

    const first = await service.debit(userId, 600, 'refund', 'refund:inv-dup');
    const second = await service.debit(userId, 600, 'refund', 'refund:inv-dup');

    expect(first).toBe(400);
    expect(second).toBe(400);
    expect(coinTxModel.create).toHaveBeenCalledTimes(2);
    // Compensation re-adds the coins (+600) for the duplicate debit.
    const compensation = walletModel.findOneAndUpdate.mock.calls[2] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(compensation[1]).toEqual({ $inc: { balanceCoins: 600 } });
  });

  it('compensates the $inc and rethrows when a NON-duplicate ledger error is thrown on credit (no orphan balance)', async () => {
    // Standalone fallback: the credit $inc commits independently of the ledger
    // append. A non-duplicate ledger error (e.g. enum validation / transient
    // write error) would otherwise leave the balance bumped with NO audit row.
    // We must undo the $inc before rethrowing so balance and ledger stay in sync.
    //
    // Call sequence:
    //   findOneAndUpdate #1 → speculative credit $inc → balance 130
    //   coinTxModel.create → throws a NON-duplicate error
    //   findOneAndUpdate #2 → compensating $inc(-30) → balance 100
    walletModel.findOneAndUpdate
      .mockReturnValueOnce(queryReturning({ balanceCoins: 130 })) // speculative credit
      .mockReturnValueOnce(queryReturning({ balanceCoins: 100 })); // compensation

    const ledgerErr = Object.assign(new Error('ledger write blew up'), { code: 121 });
    coinTxModel.create.mockRejectedValueOnce(ledgerErr);

    // The original (non-duplicate) error is surfaced — the credit did NOT succeed.
    await expect(service.credit(userId, 30, 'purchase', 'inv-boom')).rejects.toBe(ledgerErr);

    // The speculative $inc was reversed: a second findOneAndUpdate compensates by
    // exactly -30, so the balance is left untouched (no orphaned credit).
    expect(walletModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
    const compensation = walletModel.findOneAndUpdate.mock.calls[1] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(compensation[1]).toEqual({ $inc: { balanceCoins: -30 } });
  });

  it('compensates the $inc and rethrows when a NON-duplicate ledger error is thrown on debit (no orphan balance)', async () => {
    // Mirror of the credit case for the debit path: the guarded debit $inc
    // committed, the ledger append throws a non-duplicate error, and we must add
    // the coins back so the debit is not silently applied without a ledger row.
    walletModel.findOneAndUpdate
      .mockReturnValueOnce(queryReturning({ balanceCoins: 70 })) // guarded debit (100-30)
      .mockReturnValueOnce(queryReturning({ balanceCoins: 100 })); // compensation

    const ledgerErr = Object.assign(new Error('ledger write blew up'), { code: 121 });
    coinTxModel.create.mockRejectedValueOnce(ledgerErr);

    await expect(service.debit(userId, 30, 'gift_out', 'gift-boom')).rejects.toBe(ledgerErr);

    // Compensation re-adds the debited coins (+30) so the balance is restored.
    expect(walletModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
    const compensation = walletModel.findOneAndUpdate.mock.calls[1] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(compensation[1]).toEqual({ $inc: { balanceCoins: 30 } });
  });

  it('does NOT oversell under concurrency: of two debits, only the guarded match succeeds', async () => {
    // Wallet has 80 coins; two debits of 50 race. The balance-guarded
    // findOneAndUpdate is itself atomic, so exactly ONE can match a balance
    // >= 50 — the other matches nothing and is rejected. We model that by
    // returning the post-debit balance for the first call and `null` for the
    // second (the loser of the atomic guard).
    walletModel.findOneAndUpdate
      .mockReturnValueOnce(queryReturning({ balanceCoins: 30 }))
      .mockReturnValueOnce(queryReturning(null));

    const results = await Promise.allSettled([
      service.debit(userId, 50, 'top', 'race-a'),
      service.debit(userId, 50, 'top', 'race-b'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one debit went through; the other was rejected for insufficient funds.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((fulfilled[0] as PromiseFulfilledResult<number>).value).toBe(30);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      InsufficientFundsException,
    );

    // Both attempts hit the atomic guard, but only the winner wrote a ledger row.
    expect(walletModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(coinTxModel.create).toHaveBeenCalledTimes(1);
  });
});

describe('WalletService — economy hold (spend-then-refund debt + spend freeze)', () => {
  const userId = '507f1f77bcf86cd799439011';

  let service: WalletService;
  let walletModel: { findOneAndUpdate: jest.Mock; findOne: jest.Mock };
  let coinTxModel: { create: jest.Mock };

  /**
   * A `findOne(...)` stub that supports BOTH chain shapes the service uses:
   *  - `getBalance`:        `.findOne(filter).select(...).lean().exec()`
   *  - hold read helpers:   `.findOne(filter, projection, opts).lean().exec()`
   * Both terminate in `.exec()` resolving to `result`.
   */
  function findOneReturning(result: unknown): {
    select: jest.Mock;
    lean: jest.Mock;
    exec: jest.Mock;
  } {
    const stub = {
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(result),
    };
    return stub;
  }

  beforeEach(async () => {
    walletModel = { findOneAndUpdate: jest.fn(), findOne: jest.fn() };
    coinTxModel = { create: jest.fn().mockResolvedValue([{ _id: 'tx1' }]) };

    // Standalone-Mongo path (no transactions) — the realistic dev scenario.
    const connection = {
      startSession: jest.fn().mockRejectedValue(
        Object.assign(new Error('Transaction numbers are only allowed on a replica set'), {
          code: 20,
        }),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: getModelToken(Wallet.name), useValue: walletModel },
        { provide: getModelToken(CoinTransaction.name), useValue: coinTxModel },
        { provide: getConnectionToken(), useValue: connection },
      ],
    }).compile();
    service = moduleRef.get(WalletService);
  });

  it('reverseRefund on a SPENT balance: claws back nothing, records the full amount as debt + sets the hold', async () => {
    // The buyer already spent everything ⇒ balance 0. The whole 600 is owed.
    walletModel.findOne.mockReturnValue(findOneReturning({ balanceCoins: 0 }));
    // applyEconomyHold's upserting hold update.
    walletModel.findOneAndUpdate.mockReturnValue(
      queryReturning({ balanceCoins: 0, economyHold: true, heldCoins: 600 }),
    );

    const result = await service.reverseRefund(userId, 600, 'refund:inv-cb');

    expect(result).toEqual({ reversed: 0, owed: 600 });
    // No clawback debit was issued (nothing to reverse) — so no ledger row.
    expect(coinTxModel.create).not.toHaveBeenCalled();
    // The debt+hold was applied: economyHold:true and heldCoins +600, upserting.
    expect(walletModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update, options] = walletModel.findOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, Record<string, unknown>>,
      Record<string, unknown>,
    ];
    expect(filter).toMatchObject({ userId: expect.anything() });
    expect(update.$set).toEqual({ economyHold: true });
    expect(update.$inc).toEqual({ heldCoins: 600 });
    expect(options).toMatchObject({ upsert: true });
  });

  it('reverseRefund on a PARTIALLY-spent balance: claws back what remains and holds only the shortfall', async () => {
    // 250 coins left of the 600 credited ⇒ reverse 250, hold 350 as debt.
    walletModel.findOne.mockReturnValue(findOneReturning({ balanceCoins: 250 }));
    // The clawback debit (refund, exempt from the hold gate) succeeds: 250→0.
    walletModel.findOneAndUpdate
      .mockReturnValueOnce(queryReturning({ balanceCoins: 0 })) // clawback debit
      .mockReturnValueOnce(queryReturning({ balanceCoins: 0, economyHold: true, heldCoins: 350 })); // hold

    const result = await service.reverseRefund(userId, 600, 'refund:inv-part');

    expect(result).toEqual({ reversed: 250, owed: 350 });
    // The clawback was a `refund` debit of exactly the reversible 250.
    const [[row]] = coinTxModel.create.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(row).toMatchObject({ delta: -250, type: 'refund', refId: 'refund:inv-part' });
    // The debt for the unrecovered 350 was held.
    const holdUpdate = walletModel.findOneAndUpdate.mock.calls[1] as [
      unknown,
      Record<string, Record<string, unknown>>,
    ];
    expect(holdUpdate[1].$set).toEqual({ economyHold: true });
    expect(holdUpdate[1].$inc).toEqual({ heldCoins: 350 });
  });

  it('reverseRefund on a FULLY-covered balance: claws everything back, no debt and no hold', async () => {
    // Balance still holds the full 600 (buyer never spent it) ⇒ reverse all, owe 0.
    walletModel.findOne.mockReturnValue(findOneReturning({ balanceCoins: 600 }));
    walletModel.findOneAndUpdate.mockReturnValue(queryReturning({ balanceCoins: 0 }));

    const result = await service.reverseRefund(userId, 600, 'refund:inv-ok');

    expect(result).toEqual({ reversed: 600, owed: 0 });
    // Exactly the clawback debit ran — NO hold update (owed is 0).
    expect(walletModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [[row]] = coinTxModel.create.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(row).toMatchObject({ delta: -600, type: 'refund' });
  });

  it('a HELD wallet cannot SPEND: a gift_out debit is refused with EconomyHoldException (403)', async () => {
    // The guarded spend update adds `economyHold: { $ne: true }`, so a held wallet
    // matches nothing; we then re-read the hold flag and throw a 403 (not a 422).
    walletModel.findOneAndUpdate.mockReturnValue(queryReturning(null)); // no match (held)
    walletModel.findOne.mockReturnValue(findOneReturning({ economyHold: true })); // hold re-read

    const err = await service.debit(userId, 50, 'gift_out', 'gift-held').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(EconomyHoldException);
    expect((err as EconomyHoldException).getStatus()).toBe(403);

    // The spend guard included the hold condition, and NO ledger row was written.
    const [filter] = walletModel.findOneAndUpdate.mock.calls[0] as [Record<string, unknown>];
    expect(filter).toMatchObject({ economyHold: { $ne: true } });
    expect(coinTxModel.create).not.toHaveBeenCalled();
  });

  it('a non-held wallet with insufficient funds still gets InsufficientFundsException (422), not a hold error', async () => {
    walletModel.findOneAndUpdate.mockReturnValue(queryReturning(null)); // no match
    walletModel.findOne.mockReturnValue(findOneReturning({ economyHold: false })); // not held

    const err = await service.debit(userId, 50, 'top', 'top-broke').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InsufficientFundsException);
    expect((err as InsufficientFundsException).getStatus()).toBe(422);
  });

  it('a `refund` debit is EXEMPT from the hold gate (clawbacks proceed on a held wallet)', async () => {
    // A refund debit must NOT carry the economyHold condition, so a held account
    // can still be clawed back. The guarded update succeeds (balance suffices).
    walletModel.findOneAndUpdate.mockReturnValue(queryReturning({ balanceCoins: 0 }));

    await service.debit(userId, 100, 'refund', 'refund:clawback');

    const [filter] = walletModel.findOneAndUpdate.mock.calls[0] as [Record<string, unknown>];
    expect(filter).not.toHaveProperty('economyHold');
    // The hold flag is NOT re-read for a refund debit (it is never gated).
    expect(walletModel.findOne).not.toHaveBeenCalled();
  });

  it('credit RELEASES the hold once the recovered balance covers the debt', async () => {
    // A credit of 600 brings the balance to 600; the outstanding debt is 600, so
    // the debt is repaid and the hold lifts.
    walletModel.findOneAndUpdate
      .mockReturnValueOnce(queryReturning({ balanceCoins: 600 })) // the credit $inc
      .mockReturnValueOnce(queryReturning({ balanceCoins: 600, economyHold: false, heldCoins: 0 })); // release
    // maybeReleaseHold reads the current hold state: held with a 600 debt.
    walletModel.findOne.mockReturnValue(findOneReturning({ economyHold: true, heldCoins: 600 }));

    await service.credit(userId, 600, 'purchase', 'inv-repay');

    // The hold was cleared: economyHold:false + heldCoins:0, guarded on still-held.
    const releaseCall = walletModel.findOneAndUpdate.mock.calls.find(([, update]) => {
      const u = update as { $set?: { economyHold?: boolean } };
      return u.$set?.economyHold === false;
    });
    expect(releaseCall).toBeDefined();
    const [releaseFilter, releaseUpdate] = releaseCall as [
      Record<string, unknown>,
      Record<string, Record<string, unknown>>,
    ];
    expect(releaseFilter).toMatchObject({ economyHold: true });
    expect(releaseUpdate.$set).toEqual({ economyHold: false, heldCoins: 0 });
  });

  it('credit does NOT release the hold while the recovered balance is still below the debt', async () => {
    // Balance only recovers to 100 but the debt is 600 — stay frozen.
    walletModel.findOneAndUpdate.mockReturnValue(queryReturning({ balanceCoins: 100 }));
    walletModel.findOne.mockReturnValue(findOneReturning({ economyHold: true, heldCoins: 600 }));

    await service.credit(userId, 100, 'purchase', 'inv-partial-repay');

    // Only the credit $inc ran — NO release update (no $set economyHold:false).
    const releaseCall = walletModel.findOneAndUpdate.mock.calls.find(([, update]) => {
      const u = update as { $set?: { economyHold?: boolean } };
      return u.$set?.economyHold === false;
    });
    expect(releaseCall).toBeUndefined();
  });
});

describe('WalletService — transactional (replica-set) write path', () => {
  const userId = '507f1f77bcf86cd799439011';

  let service: WalletService;
  let walletModel: { findOneAndUpdate: jest.Mock; findOne: jest.Mock };
  let coinTxModel: { create: jest.Mock };
  let session: {
    withTransaction: jest.Mock;
    endSession: jest.Mock;
  };
  let connection: { startSession: jest.Mock };

  beforeEach(async () => {
    walletModel = {
      findOneAndUpdate: jest.fn(),
      // Default: a non-held wallet, so the hold read-helpers (isOnHold /
      // maybeReleaseHold) added for the economy-hold feature are safe no-ops in
      // these transaction-path tests, which assert the session threading only.
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({ economyHold: false, heldCoins: 0 }),
      }),
    };
    coinTxModel = { create: jest.fn().mockResolvedValue([{ _id: 'tx1' }]) };

    // A working replica-set session: withTransaction runs the unit of work and
    // resolves. Captures the session so we can assert it is threaded into both
    // the balance update and the ledger insert (so a ledger failure rolls back).
    session = {
      withTransaction: jest.fn(async (cb: () => Promise<unknown>) => {
        await cb();
      }),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    connection = { startSession: jest.fn().mockResolvedValue(session) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: getModelToken(Wallet.name), useValue: walletModel },
        { provide: getModelToken(CoinTransaction.name), useValue: coinTxModel },
        { provide: getConnectionToken(), useValue: connection },
      ],
    }).compile();

    service = moduleRef.get(WalletService);
  });

  it('wraps debit in a transaction, threading the session through both writes', async () => {
    walletModel.findOneAndUpdate.mockReturnValue(queryReturning({ balanceCoins: 70 }));

    const newBalance = await service.debit(userId, 30, 'gift_out', 'gift-1');

    expect(newBalance).toBe(70);
    expect(connection.startSession).toHaveBeenCalledTimes(1);
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(session.endSession).toHaveBeenCalledTimes(1);

    // The balance update carries the session (3rd arg options).
    const [, , options] = walletModel.findOneAndUpdate.mock.calls[0] as [
      unknown,
      unknown,
      Record<string, unknown>,
    ];
    expect(options.session).toBe(session);

    // The ledger insert also carries the session so it commits/rolls back atomically.
    const [, txOptions] = coinTxModel.create.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(txOptions.session).toBe(session);
  });

  it('caches transaction support: a second write reuses the session path without re-probing failure', async () => {
    walletModel.findOneAndUpdate.mockReturnValue(queryReturning({ balanceCoins: 50 }));

    await service.credit(userId, 10, 'purchase', 'inv-1');
    await service.credit(userId, 10, 'purchase', 'inv-2');

    // Both writes used a session; no fallback ever ran.
    expect(connection.startSession).toHaveBeenCalledTimes(2);
    expect(session.withTransaction).toHaveBeenCalledTimes(2);
  });

  it('does NOT manually compensate on a thrown ledger error inside a transaction (the abort rolls the $inc back)', async () => {
    // On the replica-set path a thrown ledger append must bubble out of the
    // unit of work so `withTransaction` ABORTS — the speculative $inc rolls back
    // with the transaction. We must NOT issue a manual compensating $inc here
    // (that would double-undo against an aborting session).
    walletModel.findOneAndUpdate.mockReturnValue(queryReturning({ balanceCoins: 130 }));
    const ledgerErr = Object.assign(new Error('ledger write blew up'), { code: 121 });
    coinTxModel.create.mockRejectedValueOnce(ledgerErr);

    await expect(service.credit(userId, 30, 'purchase', 'inv-tx-boom')).rejects.toBe(ledgerErr);

    // Exactly ONE findOneAndUpdate (the speculative credit) — no manual
    // compensation; the transaction abort is responsible for the rollback.
    expect(walletModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  it('propagates InsufficientFundsException from inside the transaction without falling back', async () => {
    // Guarded update finds nothing inside the transaction ⇒ business error.
    walletModel.findOneAndUpdate.mockReturnValue(queryReturning(null));

    await expect(service.debit(userId, 999, 'top', 'top-x')).rejects.toBeInstanceOf(
      InsufficientFundsException,
    );

    // The transaction was opened and the session closed, but NO sequential
    // fallback retry happened (the guard matched nothing, not a transport error).
    expect(connection.startSession).toHaveBeenCalledTimes(1);
    expect(session.endSession).toHaveBeenCalledTimes(1);
    expect(coinTxModel.create).not.toHaveBeenCalled();
    // Exactly one guarded update attempt — no second (fallback) attempt.
    expect(walletModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('CoinTransaction ledger — type enum is the zod single source of truth', () => {
  /**
   * Regression guard for a P0 money bug: the Mongoose `type` enum had drifted
   * from `coinTxTypeSchema`, omitting `'cover'`. A paid profile-cover purchase
   * then debited the balance and 500'd on the ledger insert (coin theft on a
   * standalone Mongo). We now derive the enum from `coinTxTypeSchema.options`,
   * so this asserts the persisted enum EXACTLY mirrors the contract and that
   * `'cover'` in particular is accepted.
   */
  function ledgerTypeEnum(): readonly string[] {
    // SchemaFactory stores the enum on the `type` path's `enumValues`.
    return CoinTransactionSchema.path('type').options.enum as string[];
  }

  it("includes 'cover' (the value the cover-purchase path writes)", () => {
    expect(ledgerTypeEnum()).toContain('cover');
  });

  it('mirrors coinTxTypeSchema.options exactly (no drift, same order)', () => {
    expect(ledgerTypeEnum()).toEqual([...coinTxTypeSchema.options]);
  });

  it('declares a PARTIAL unique index on (type, refId) for refId-keyed idempotency', () => {
    // P0: at most one ledger row per (type, refId) when refId is a string, so a
    // redelivered fulfilment cannot double-credit/-debit. The index MUST be
    // partial (refId: $type string) so the many legit refId:null rows coexist.
    const idx = CoinTransactionSchema.indexes().find(([fields]) => {
      const f = fields as Record<string, unknown>;
      return f.type === 1 && f.refId === 1;
    });
    expect(idx).toBeDefined();
    const [, options] = idx as [Record<string, number>, Record<string, unknown>];
    expect(options.unique).toBe(true);
    expect(options.partialFilterExpression).toEqual({ refId: { $type: 'string' } });
  });

  it('accepts a `cover` row and rejects an unknown type under enum validation', () => {
    // Build a real (connection-less) model purely to run `validateSync`, which
    // exercises the actual `type` enum validator without touching a database.
    const LedgerModel = model('CoinTransactionEnumTest', CoinTransactionSchema);
    const base = {
      userId: new Types.ObjectId('507f1f77bcf86cd799439011'),
      delta: -120,
      refId: 'sunset',
      balanceAfter: 0,
    };

    // `validateSync` returns undefined when every validator (incl. the enum)
    // passes — i.e. a `cover` ledger row is no longer rejected.
    expect(new LedgerModel({ ...base, type: 'cover' }).validateSync()).toBeUndefined();

    // An out-of-contract value still fails, proving the enum is enforced.
    const bad = new LedgerModel({ ...base, type: 'not_a_real_type' }).validateSync();
    expect(bad?.errors?.type).toBeDefined();
  });
});
