import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { coinTxTypeSchema } from '@ruletka/shared-types';
import { model, Types } from 'mongoose';

import { CoinTransaction, CoinTransactionSchema } from './schemas/coin-transaction.schema';
import { Wallet } from './schemas/wallet.schema';
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
      findOne: jest.fn(),
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

describe('WalletService — transactional (replica-set) write path', () => {
  const userId = '507f1f77bcf86cd799439011';

  let service: WalletService;
  let walletModel: { findOneAndUpdate: jest.Mock };
  let coinTxModel: { create: jest.Mock };
  let session: {
    withTransaction: jest.Mock;
    endSession: jest.Mock;
  };
  let connection: { startSession: jest.Mock };

  beforeEach(async () => {
    walletModel = { findOneAndUpdate: jest.fn() };
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
