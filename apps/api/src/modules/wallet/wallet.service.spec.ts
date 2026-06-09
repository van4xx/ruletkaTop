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

  /**
   * The hold's debt `$inc` is now applied in TWO atomic steps by
   * applyEconomyHold: (a) an upserting "ensure wallet exists" findOneAndUpdate
   * carrying NO debt, then (b) a `heldRefIds: { $ne: refId }`-guarded
   * findOneAndUpdate that `$inc`s `heldCoins` and `$addToSet`s the refId (so a
   * redelivery is a no-op). This helper finds the GUARDED debt-inc call.
   */
  function findDebtIncCall(): [Record<string, unknown>, Record<string, Record<string, unknown>>] {
    const call = walletModel.findOneAndUpdate.mock.calls.find(([, update]) => {
      const u = update as { $inc?: { heldCoins?: number } };
      return typeof u.$inc?.heldCoins === 'number';
    });
    return call as [Record<string, unknown>, Record<string, Record<string, unknown>>];
  }

  it('reverseRefund on a SPENT balance: claws back nothing, records the full amount as debt + sets the hold', async () => {
    // The buyer already spent everything ⇒ balance 0. The whole 600 is owed.
    walletModel.findOne.mockReturnValue(findOneReturning({ balanceCoins: 0 }));
    // applyEconomyHold: (a) ensure-wallet upsert, (b) guarded debt $inc.
    walletModel.findOneAndUpdate
      .mockReturnValueOnce(queryReturning({ balanceCoins: 0 })) // ensure-wallet upsert
      .mockReturnValueOnce(queryReturning({ economyHold: true, heldCoins: 600 })); // guarded debt $inc

    const result = await service.reverseRefund(userId, 600, 'refund:inv-cb');

    expect(result).toEqual({ reversed: 0, owed: 600 });
    // No clawback debit was issued (nothing to reverse) — so no ledger row.
    expect(coinTxModel.create).not.toHaveBeenCalled();
    // The debt+hold was applied idempotently: economyHold:true, heldCoins +600,
    // guarded on the refId not yet held, and the refId recorded so a redelivery
    // can't double-count.
    const [filter, update] = findDebtIncCall();
    expect(filter).toMatchObject({ userId: expect.anything(), heldRefIds: { $ne: 'refund:inv-cb' } });
    expect(update.$set).toEqual({ economyHold: true, holdRefId: 'refund:inv-cb' });
    expect(update.$inc).toEqual({ heldCoins: 600 });
    expect(update.$addToSet).toEqual({ heldRefIds: 'refund:inv-cb' });
  });

  it('reverseRefund on a PARTIALLY-spent balance: claws back what remains and holds only the shortfall', async () => {
    // 250 coins left of the 600 credited ⇒ reverse 250, hold 350 as debt.
    // getBalance reads 250 first; after the clawback debit the loop re-reads and
    // finds 0, so it stops (no further clawback).
    walletModel.findOne
      .mockReturnValueOnce(findOneReturning({ balanceCoins: 250 })) // getBalance (loop pass 1)
      // credit()/debit() internal hold reads default to non-held; loop pass 2 read:
      .mockReturnValue(findOneReturning({ balanceCoins: 0, economyHold: false, heldCoins: 0 }));
    // The clawback debit (refund, exempt from the hold gate) succeeds: 250→0,
    // then applyEconomyHold's two steps for the 350 shortfall.
    walletModel.findOneAndUpdate
      .mockReturnValueOnce(queryReturning({ balanceCoins: 0 })) // clawback debit
      .mockReturnValueOnce(queryReturning({ balanceCoins: 0 })) // ensure-wallet upsert
      .mockReturnValueOnce(queryReturning({ economyHold: true, heldCoins: 350 })); // guarded debt $inc

    const result = await service.reverseRefund(userId, 600, 'refund:inv-part');

    expect(result).toEqual({ reversed: 250, owed: 350 });
    // The clawback was a `refund` debit of exactly the reversible 250.
    const [[row]] = coinTxModel.create.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(row).toMatchObject({ delta: -250, type: 'refund', refId: 'refund:inv-part' });
    // The debt for the unrecovered 350 was held (idempotent, guarded $inc).
    const [, debtUpdate] = findDebtIncCall();
    expect(debtUpdate.$set).toEqual({ economyHold: true, holdRefId: 'refund:inv-part' });
    expect(debtUpdate.$inc).toEqual({ heldCoins: 350 });
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

  it('credit that fully covers the debt CONSUMES the recovered balance (debits it + writes a refund ledger row) and lifts the hold', async () => {
    // A credit of 600 brings the balance to 600; the outstanding debt is 600. The
    // debt is repaid by DEBITING the recovered 600 back out (not by silently
    // wiping the flag — that would make the buyer whole twice) and writing a
    // matching `refund` ledger row, so balanceCoins stays equal to Σ(ledger).
    walletModel.findOneAndUpdate
      .mockReturnValueOnce(queryReturning({ balanceCoins: 600 })) // credit $inc → 600
      .mockReturnValueOnce(queryReturning({ balanceCoins: 0 })); // repayment debit → 0, hold clears
    walletModel.findOne
      // maybeReleaseHold reads the hold state: held, 600 debt, namespaced refId.
      .mockReturnValueOnce(
        findOneReturning({ economyHold: true, heldCoins: 600, holdRefId: 'refund:inv-cb', balanceCoins: 600 }),
      )
      // post-credit balance re-read (after the repayment debit drew it to 0).
      .mockReturnValue(findOneReturning({ balanceCoins: 0 }));

    const newBalance = await service.credit(userId, 600, 'purchase', 'inv-repay');

    // The returned balance reflects the repayment debit — NOT the pre-repayment 600.
    expect(newBalance).toBe(0);

    // The repayment update DEBITED the balance AND drew the debt down, clearing
    // the hold at zero — guarded on the still-held debt so a concurrent release
    // can't double-spend the recovered balance.
    const repayCall = walletModel.findOneAndUpdate.mock.calls.find(([, update]) => {
      const u = update as { $inc?: { balanceCoins?: number } };
      return (u.$inc?.balanceCoins ?? 0) < 0;
    });
    expect(repayCall).toBeDefined();
    const [repayFilter, repayUpdate] = repayCall as [
      Record<string, unknown>,
      Record<string, Record<string, unknown>>,
    ];
    expect(repayFilter).toMatchObject({ economyHold: true, heldCoins: 600, balanceCoins: { $gte: 600 } });
    expect(repayUpdate.$inc).toEqual({ balanceCoins: -600, heldCoins: -600 });
    expect(repayUpdate.$set).toEqual({ economyHold: false, holdRefId: null });

    // A `refund` ledger row was written for the repayment so the invariant holds:
    // the recovered balance was removed from spendable funds, not kept for free.
    const repayRow = coinTxModel.create.mock.calls
      .map((c) => (c[0] as Array<Record<string, unknown>>)[0])
      .find((r) => r?.type === 'refund');
    expect(repayRow).toMatchObject({ delta: -600, type: 'refund', refId: 'holdrepay:refund:inv-cb:600' });
  });

  it('credit below the debt makes a PARTIAL repayment (debits what it can, keeps the hold)', async () => {
    // Balance recovers by only 100 against a 600 debt: repay 100 (debit it out +
    // refund ledger row), draw the debt to 500, and STAY frozen (hold not lifted).
    walletModel.findOneAndUpdate
      .mockReturnValueOnce(queryReturning({ balanceCoins: 100 })) // credit $inc → 100
      .mockReturnValueOnce(queryReturning({ balanceCoins: 0 })); // repayment debit → 0
    walletModel.findOne
      .mockReturnValueOnce(
        findOneReturning({ economyHold: true, heldCoins: 600, holdRefId: 'refund:inv-cb', balanceCoins: 100 }),
      )
      .mockReturnValue(findOneReturning({ balanceCoins: 0 }));

    await service.credit(userId, 100, 'purchase', 'inv-partial-repay');

    const repayCall = walletModel.findOneAndUpdate.mock.calls.find(([, update]) => {
      const u = update as { $inc?: { balanceCoins?: number } };
      return (u.$inc?.balanceCoins ?? 0) < 0;
    });
    expect(repayCall).toBeDefined();
    const [, repayUpdate] = repayCall as [Record<string, unknown>, Record<string, Record<string, unknown>>];
    // Only 100 repaid; the hold is NOT cleared (no $set economyHold:false).
    expect(repayUpdate.$inc).toEqual({ balanceCoins: -100, heldCoins: -100 });
    expect(repayUpdate.$set).toBeUndefined();

    const repayRow = coinTxModel.create.mock.calls
      .map((c) => (c[0] as Array<Record<string, unknown>>)[0])
      .find((r) => r?.type === 'refund');
    expect(repayRow).toMatchObject({ delta: -100, type: 'refund' });
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

// ───────────────────────────────────────────────────────────────────────────
// In-memory fake wallet + ledger that actually MODELS the atomic
// single-document semantics the service depends on, so each scenario can assert
// the ACCOUNTING INVARIANT end-to-end:  balanceCoins === Σ(ledger deltas).
//
// This is the real regression guard for the wave-4 chargeback bugs: call-
// sequence mocks can't catch "balance != ledger", but a model that applies the
// same `$inc`/`$set`/`$addToSet`/guards Mongo would — including the unique
// `(type, refId)` ledger index that drives idempotency — does.
// ───────────────────────────────────────────────────────────────────────────
describe('WalletService — economy-hold accounting invariant (balance == Σ ledger)', () => {
  const userId = '507f1f77bcf86cd799439011';

  interface WalletDoc {
    userId: string;
    balanceCoins: number;
    economyHold: boolean;
    heldCoins: number;
    heldRefIds: string[];
    holdRefId: string | null;
  }

  interface LedgerRow {
    delta: number;
    type: string;
    refId: string | null;
    balanceAfter: number;
  }

  interface FindOneChain {
    select: () => FindOneChain;
    lean: () => FindOneChain;
    exec: () => Promise<WalletDoc | null>;
  }

  /** Does `doc` satisfy a (subset of) Mongo query operators we use? */
  function matches(doc: WalletDoc, filter: Record<string, unknown>): boolean {
    for (const [key, cond] of Object.entries(filter)) {
      if (key === 'userId') continue; // single-wallet fake
      const val = (doc as unknown as Record<string, unknown>)[key];
      if (cond !== null && typeof cond === 'object') {
        const c = cond as Record<string, unknown>;
        if ('$gte' in c && !((val as number) >= (c.$gte as number))) return false;
        if ('$ne' in c) {
          if (Array.isArray(val)) {
            if (val.includes(c.$ne)) return false;
          } else if (val === c.$ne) {
            return false;
          }
        }
      } else if (val !== cond) {
        return false;
      }
    }
    return true;
  }

  /** Apply a (subset of) Mongo update operators in place. */
  function applyUpdate(doc: WalletDoc, update: Record<string, Record<string, unknown>>): void {
    const d = doc as unknown as Record<string, unknown>;
    if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) d[k] = ((d[k] as number) ?? 0) + (v as number);
    if (update.$set) for (const [k, v] of Object.entries(update.$set)) d[k] = v;
    if (update.$setOnInsert) {
      /* only on insert — handled by caller */
    }
    if (update.$addToSet)
      for (const [k, v] of Object.entries(update.$addToSet)) {
        const arr = (d[k] as unknown[]) ?? [];
        if (!arr.includes(v)) arr.push(v);
        d[k] = arr;
      }
    if (update.$unset) for (const k of Object.keys(update.$unset)) d[k] = k === 'heldRefIds' ? [] : undefined;
  }

  /**
   * A fake Mongoose-ish model over a SINGLE wallet doc, supporting the exact
   * `findOneAndUpdate(filter, update, opts)` / `findOne(filter, proj, opts)`
   * surface the service uses, with `{ new: true }` and `upsert` semantics.
   */
  function makeFakeModels() {
    const wallet: WalletDoc = {
      userId,
      balanceCoins: 0,
      economyHold: false,
      heldCoins: 0,
      heldRefIds: [],
      holdRefId: null,
    };
    // Ledger with the unique (type, refId) index enforced for string refIds.
    const ledger: LedgerRow[] = [];

    const walletModel = {
      findOneAndUpdate: (
        filter: Record<string, unknown>,
        update: Record<string, Record<string, unknown>>,
        opts?: Record<string, unknown>,
      ): { exec: () => Promise<WalletDoc | null> } => ({
        exec: () => {
          if (!matches(wallet, filter)) {
            // The single wallet always exists (userId is the only insert key), so
            // an upsert never inserts a second doc; a non-match means a guard
            // (e.g. $ne / $gte) failed → return null like Mongo would.
            return Promise.resolve(null);
          }
          applyUpdate(wallet, update);
          return Promise.resolve({ ...wallet });
        },
      }),
      findOne: (filter: Record<string, unknown>, _proj?: unknown, _opts?: unknown): FindOneChain => {
        const chain: FindOneChain = {
          select: () => chain,
          lean: () => chain,
          exec: () => Promise.resolve(matches(wallet, filter) ? { ...wallet } : null),
        };
        return chain;
      },
    };

    const coinTxModel = {
      create: (rows: LedgerRow[]): Promise<Array<{ _id: string }>> => {
        const row = rows[0]!;
        if (row.refId !== null && ledger.some((r) => r.type === row.type && r.refId === row.refId)) {
          // Unique (type, refId) partial index violation → E11000, as Mongo does.
          return Promise.reject(Object.assign(new Error('E11000 duplicate key error'), { code: 11000 }));
        }
        ledger.push({ ...row });
        return Promise.resolve([{ _id: `tx${ledger.length}` }]);
      },
    };

    return { wallet, ledger, walletModel, coinTxModel };
  }

  async function buildService(walletModel: unknown, coinTxModel: unknown): Promise<WalletService> {
    const connection = {
      // Standalone path (no transactions) — exercises the sequential atomic
      // fallback, which is where balance/ledger drift is hardest to keep in sync.
      startSession: jest.fn().mockRejectedValue(
        Object.assign(new Error('Transaction numbers are only allowed on a replica set'), { code: 20 }),
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
    return moduleRef.get(WalletService);
  }

  const ledgerSum = (ledger: Array<{ delta: number }>): number => ledger.reduce((s, r) => s + r.delta, 0);

  it('release CONSUMES the recovered balance and writes a refund ledger row (invariant holds, no double make-whole)', async () => {
    const { wallet, ledger, walletModel, coinTxModel } = makeFakeModels();
    const service = await buildService(walletModel, coinTxModel);

    // Buyer bought 600, spent all 600, then charged back → full 600 is debt+hold.
    await service.credit(userId, 600, 'purchase', 'inv-1'); // balance 600, ledger +600
    await service.debit(userId, 600, 'gift_out', 'gift-1'); // balance 0,   ledger -600 (spent)
    await service.reverseRefund(userId, 600, 'refund:inv-1'); // nothing to claw back → hold 600

    expect(wallet.economyHold).toBe(true);
    expect(wallet.heldCoins).toBe(600);
    expect(wallet.balanceCoins).toBe(0);
    expect(wallet.balanceCoins).toBe(ledgerSum(ledger)); // invariant

    // A fresh 600 credit (e.g. a new top-up) repays the debt. The OLD bug wiped
    // the flag and left the 600 spendable (made whole twice). Now the recovered
    // 600 is debited back out under a refund ledger row, so the buyer is NOT
    // enriched and the invariant survives.
    const balanceAfter = await service.credit(userId, 600, 'purchase', 'inv-2');

    expect(balanceAfter).toBe(0); // recovered 600 consumed to repay the 600 debt
    expect(wallet.balanceCoins).toBe(0);
    expect(wallet.economyHold).toBe(false);
    expect(wallet.heldCoins).toBe(0);
    expect(wallet.balanceCoins).toBe(ledgerSum(ledger)); // INVARIANT still holds

    // A holdrepay refund row was appended for the repayment.
    const repay = ledger.find((r) => r.type === 'refund' && (r as { refId?: string }).refId?.startsWith('holdrepay:'));
    expect(repay).toMatchObject({ delta: -600, type: 'refund' });
  });

  it('PARTIAL repayment over MULTIPLE credits draws the debt down and lifts the hold only at zero (invariant holds throughout)', async () => {
    const { wallet, ledger, walletModel, coinTxModel } = makeFakeModels();
    const service = await buildService(walletModel, coinTxModel);

    await service.credit(userId, 600, 'purchase', 'inv-1');
    await service.debit(userId, 600, 'gift_out', 'gift-1');
    await service.reverseRefund(userId, 600, 'refund:inv-1'); // debt 600, hold on

    // Credit #1: 200 → repays 200, debt 400, STILL frozen.
    await service.credit(userId, 200, 'purchase', 'inv-a');
    expect(wallet.heldCoins).toBe(400);
    expect(wallet.economyHold).toBe(true);
    expect(wallet.balanceCoins).toBe(0);
    expect(wallet.balanceCoins).toBe(ledgerSum(ledger));

    // Credit #2: 400 → repays the remaining 400, debt 0, hold LIFTS.
    const after = await service.credit(userId, 400, 'purchase', 'inv-b');
    expect(after).toBe(0);
    expect(wallet.heldCoins).toBe(0);
    expect(wallet.economyHold).toBe(false);
    expect(wallet.balanceCoins).toBe(0);
    expect(wallet.balanceCoins).toBe(ledgerSum(ledger)); // invariant

    // Now the account can spend again, and a credit beyond the (cleared) debt
    // simply lands as spendable balance.
    const spendable = await service.credit(userId, 50, 'bonus', 'bonus-1');
    expect(spendable).toBe(50);
    expect(wallet.balanceCoins).toBe(ledgerSum(ledger));
  });

  it('a REDELIVERED refund webhook does NOT double the debt (hold $inc is idempotent per refId)', async () => {
    const { wallet, ledger, walletModel, coinTxModel } = makeFakeModels();
    const service = await buildService(walletModel, coinTxModel);

    await service.credit(userId, 600, 'purchase', 'inv-1');
    await service.debit(userId, 600, 'gift_out', 'gift-1'); // spent

    // First refund delivery: full 600 becomes debt.
    const first = await service.reverseRefund(userId, 600, 'refund:inv-1');
    expect(first).toEqual({ reversed: 0, owed: 600 });
    expect(wallet.heldCoins).toBe(600);

    // REDELIVERY of the SAME refund webhook: must NOT add another 600 of debt.
    const second = await service.reverseRefund(userId, 600, 'refund:inv-1');
    expect(second).toEqual({ reversed: 0, owed: 600 }); // owed is recomputed, but…
    expect(wallet.heldCoins).toBe(600); // …the debt is NOT doubled (still 600)
    expect(wallet.heldRefIds).toEqual(['refund:inv-1']); // recorded once
    expect(wallet.balanceCoins).toBe(ledgerSum(ledger)); // invariant intact
  });

  it('reverseRefund under a CONCURRENT-SPEND race records the FULL unrecovered debt + freezes (InsufficientFunds never escapes)', async () => {
    const { wallet, ledger, walletModel, coinTxModel } = makeFakeModels();
    const service = await buildService(walletModel, coinTxModel);

    // Buyer has 600 spendable from the purchase being reversed.
    await service.credit(userId, 600, 'purchase', 'inv-1');
    expect(wallet.balanceCoins).toBe(600);

    // Inject the TOCTOU: the very first balance read inside reverseRefund sees
    // 600, but BEFORE the clawback debit lands a concurrent spend drains the
    // wallet to 0. A REAL concurrent spend writes its own ledger row, so the
    // harness models the drain as a genuine -600 spend (balance AND ledger) to
    // keep the invariant honest — the service must keep it true from there.
    const realFindOne = walletModel.findOne.bind(walletModel);
    let raced = false;
    walletModel.findOne = ((filter: Record<string, unknown>, proj?: unknown, opts?: unknown) => {
      const chain = realFindOne(filter, proj, opts);
      const realExec = chain.exec.bind(chain);
      chain.exec = () =>
        realExec().then((res) => {
          if (!raced && res && res.balanceCoins === 600) {
            raced = true;
            wallet.balanceCoins = 0; // concurrent spend lands here → debit will miss
            ledger.push({ delta: -600, type: 'gift_out', refId: 'race-spend', balanceAfter: 0 });
          }
          return res;
        });
      return chain;
    }) as typeof walletModel.findOne;

    const result = await service.reverseRefund(userId, 600, 'refund:inv-1');

    // The clawback debit raced and missed (balance already 0); reverseRefund
    // caught the InsufficientFundsException, re-read (now 0), recovered nothing,
    // and recorded the FULL 600 as debt + froze the account. The exception did
    // NOT escape.
    expect(result.reversed).toBe(0);
    expect(result.owed).toBe(600);
    expect(wallet.economyHold).toBe(true);
    expect(wallet.heldCoins).toBe(600);
    expect(wallet.balanceCoins).toBe(0);
    expect(wallet.balanceCoins).toBe(ledgerSum(ledger)); // invariant: no free value
  });

  it('reverseRefund with a PARTIAL concurrent spend claws back what remains and holds the rest', async () => {
    const { wallet, ledger, walletModel, coinTxModel } = makeFakeModels();
    const service = await buildService(walletModel, coinTxModel);

    await service.credit(userId, 600, 'purchase', 'inv-1'); // balance 600

    // Concurrent spend of 350 lands right after the first balance read of 600,
    // leaving 250. The first clawback attempt (debit 600) misses; the retry
    // re-reads 250 and claws that back; the remaining 350 becomes debt. The
    // concurrent spend writes its own -350 ledger row (a real spend would), so
    // the invariant is honest.
    const realFindOne = walletModel.findOne.bind(walletModel);
    let raced = false;
    walletModel.findOne = ((filter: Record<string, unknown>, proj?: unknown, opts?: unknown) => {
      const chain = realFindOne(filter, proj, opts);
      const realExec = chain.exec.bind(chain);
      chain.exec = () =>
        realExec().then((res) => {
          if (!raced && res && res.balanceCoins === 600) {
            raced = true;
            wallet.balanceCoins = 250; // 350 spent concurrently
            ledger.push({ delta: -350, type: 'gift_out', refId: 'race-spend', balanceAfter: 250 });
          }
          return res;
        });
      return chain;
    }) as typeof walletModel.findOne;

    const result = await service.reverseRefund(userId, 600, 'refund:inv-1');

    expect(result.reversed).toBe(250);
    expect(result.owed).toBe(350);
    expect(wallet.economyHold).toBe(true);
    expect(wallet.heldCoins).toBe(350);
    expect(wallet.balanceCoins).toBe(0); // 250 clawed back from the 250 left
    expect(wallet.balanceCoins).toBe(ledgerSum(ledger)); // invariant
  });
});
