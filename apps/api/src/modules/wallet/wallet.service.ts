import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';

import type { CoinTransaction as CoinTransactionContract, CoinTxType } from '@ruletka/shared-types';

import { CoinTransaction, CoinTransactionDocument } from './schemas/coin-transaction.schema';
import { Wallet, WalletDocument } from './schemas/wallet.schema';
import { InsufficientFundsException } from './insufficient-funds.exception';

/**
 * Authoritative, atomic accounting service for user coin balances.
 *
 * EXPORTED from {@link WalletModule} and consumed cross-module by `gifts`
 * (debit `gift_out`), `top` (debit `top`) and `payments` (credit `purchase` /
 * `bonus`, refund). Structurally implements the payments-side
 * `WalletServiceContract` (`getBalance` / `credit` / `debit`) so the integrator
 * can bind it to the `WALLET_SERVICE` token without a hard class dependency.
 *
 * ── Atomicity model ───────────────────────────────────────────────────────
 * Each mutation does two writes that must agree: the wallet balance and an
 * append-only {@link CoinTransaction} ledger row carrying `balanceAfter`.
 *
 * The balance write is ALWAYS a single-document atomic `findOneAndUpdate`:
 *  - debit uses a guard `{ balanceCoins: { $gte: coins } }` so an overdraft can
 *    never occur even under concurrency — a non-match means insufficient funds.
 *  - credit uses an upsert so a missing wallet is lazily materialised.
 *
 * When the deployment supports multi-document transactions (replica set), we
 * wrap both writes in a session so a ledger-append failure rolls back the
 * balance. On a standalone dev Mongo (no transactions) we degrade gracefully:
 * the guarded balance update — itself atomic — runs first, then the ledger row
 * is appended. The overdraft invariant is preserved either way.
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  /**
   * Tri-state cache of whether the connected Mongo supports transactions.
   * `undefined` until probed; set on first transactional attempt.
   */
  private transactionsSupported?: boolean;

  constructor(
    @InjectModel(Wallet.name) private readonly walletModel: Model<WalletDocument>,
    @InjectModel(CoinTransaction.name)
    private readonly coinTxModel: Model<CoinTransactionDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * Lazily create (idempotently) a zero-balance wallet for a user and return
   * the document. Safe to call repeatedly; concurrent calls converge on the
   * single unique document.
   */
  async ensureWallet(userId: string): Promise<WalletDocument> {
    const _id = new Types.ObjectId(userId);
    const doc = await this.walletModel
      .findOneAndUpdate(
        { userId: _id },
        { $setOnInsert: { userId: _id, balanceCoins: 0 } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
    return doc;
  }

  /** Current spendable balance for a user (0 if no wallet exists yet). */
  async getBalance(userId: string): Promise<number> {
    const doc = await this.walletModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .select('balanceCoins')
      .lean()
      .exec();
    return doc?.balanceCoins ?? 0;
  }

  /**
   * Atomically credit `coins` to a user's wallet and append a ledger row.
   * Creates the wallet on the fly if absent. Returns the new balance.
   *
   * @param coins positive integer amount of coins to add.
   */
  async credit(
    userId: string,
    coins: number,
    type: CoinTxType,
    refId: string | null,
  ): Promise<number> {
    this.assertPositiveInt(coins);
    const _id = new Types.ObjectId(userId);

    return this.runWalletWrite(async (session) => {
      const updated = await this.walletModel
        .findOneAndUpdate(
          { userId: _id },
          { $inc: { balanceCoins: coins }, $setOnInsert: { userId: _id } },
          {
            new: true,
            upsert: true,
            setDefaultsOnInsert: true,
            ...(session ? { session } : {}),
          },
        )
        .exec();

      await this.appendLedger(_id, coins, type, refId, updated.balanceCoins, session);
      return updated.balanceCoins;
    });
  }

  /**
   * Atomically debit `coins` from a user's wallet (guarded by
   * `balanceCoins >= coins`) and append a ledger row. Returns the new balance.
   *
   * @throws InsufficientFundsException (422) when the balance is too low (or no
   *         wallet exists).
   * @param coins positive integer amount of coins to remove.
   */
  async debit(
    userId: string,
    coins: number,
    type: CoinTxType,
    refId: string | null,
  ): Promise<number> {
    this.assertPositiveInt(coins);
    const _id = new Types.ObjectId(userId);

    return this.runWalletWrite(async (session) => {
      // Guarded single-document update: only matches when funds suffice, so an
      // overdraft is impossible even under concurrent debits.
      const updated = await this.walletModel
        .findOneAndUpdate(
          { userId: _id, balanceCoins: { $gte: coins } },
          { $inc: { balanceCoins: -coins } },
          { new: true, ...(session ? { session } : {}) },
        )
        .exec();

      if (!updated) {
        // No document matched ⇒ either no wallet or balance < coins.
        throw new InsufficientFundsException();
      }

      await this.appendLedger(_id, -coins, type, refId, updated.balanceCoins, session);
      return updated.balanceCoins;
    });
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** Append a single immutable ledger row reflecting a balance mutation. */
  private async appendLedger(
    userId: Types.ObjectId,
    delta: number,
    type: CoinTxType,
    refId: string | null,
    balanceAfter: number,
    session?: ClientSession,
  ): Promise<void> {
    await this.coinTxModel.create(
      [{ userId, delta, type, refId: refId ?? null, balanceAfter }],
      session ? { session } : {},
    );
  }

  /**
   * Execute a balance+ledger write unit, using a transaction when the
   * deployment supports one and degrading to sequential atomic writes on a
   * standalone Mongo. `InsufficientFundsException` thrown inside aborts the
   * transaction and propagates unchanged.
   */
  private async runWalletWrite<T>(work: (session?: ClientSession) => Promise<T>): Promise<T> {
    if (this.transactionsSupported === false) {
      return work(undefined);
    }

    let session: ClientSession | undefined;
    try {
      session = await this.connection.startSession();
      let result: T;
      await session.withTransaction(async () => {
        result = await work(session);
      });
      this.transactionsSupported = true;
      // `result` is always assigned by a completed `withTransaction` callback.
      return result!;
    } catch (err) {
      // Business error: let it bubble (transaction already aborted).
      if (err instanceof InsufficientFundsException) {
        throw err;
      }
      // Standalone Mongo can't do transactions — detect, cache, and retry
      // without a session so dev environments work unchanged.
      if (this.isUnsupportedTransactionError(err)) {
        this.transactionsSupported = false;
        this.logger.warn(
          'MongoDB does not support transactions (standalone) — wallet writes ' +
            'fall back to sequential atomic updates.',
        );
        return work(undefined);
      }
      throw err;
    } finally {
      await session?.endSession();
    }
  }

  /**
   * Heuristic for "this Mongo cannot run transactions" (standalone server).
   * Matches the well-known error code 20 (IllegalOperation) / messages emitted
   * when sessions or transactions are unavailable.
   */
  private isUnsupportedTransactionError(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) {
      return false;
    }
    const code = (err as { code?: number | string }).code;
    const message = (err as { message?: string }).message ?? '';
    return (
      code === 20 ||
      code === 'IllegalOperation' ||
      /transaction numbers are only allowed on a replica set/i.test(message) ||
      /transactions are not supported/i.test(message) ||
      /this MongoDB deployment does not support retryable writes/i.test(message) ||
      /Transaction.*not supported/i.test(message)
    );
  }

  /** Guard: amounts must be strictly-positive integers. */
  private assertPositiveInt(coins: number): void {
    if (!Number.isInteger(coins) || coins <= 0) {
      throw new InsufficientFundsException('Coin amount must be a positive integer');
    }
  }

  /**
   * Map a hydrated ledger document to the shared `CoinTransaction` shape.
   * Used by the controller's paginated history endpoint.
   */
  toCoinTransaction(doc: CoinTransactionDocument): CoinTransactionContract {
    return {
      id: doc._id.toString(),
      userId: doc.userId.toString(),
      delta: doc.delta,
      type: doc.type,
      refId: doc.refId ?? null,
      balanceAfter: doc.balanceAfter,
      createdAt: doc.get('createdAt').toISOString(),
    };
  }

  /** Direct access to the ledger model for the controller's history query. */
  get ledgerModel(): Model<CoinTransactionDocument> {
    return this.coinTxModel;
  }
}
