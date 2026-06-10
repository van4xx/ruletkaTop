import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';

import type { CoinTransaction as CoinTransactionContract, CoinTxType } from '@ruletka/shared-types';

import { CoinTransaction, CoinTransactionDocument } from './schemas/coin-transaction.schema';
import { Wallet, WalletDocument } from './schemas/wallet.schema';
import { EconomyHoldException } from './economy-hold.exception';
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

      // Append the ledger row guarded by the unique `(type, refId)` index. If a
      // row already exists for this refId, this credit was already applied (a
      // redelivered webhook / retried fulfilment): undo the `$inc` we just did
      // and return the balance WITHOUT the duplicate credit. AT-MOST-ONCE. If the
      // append THROWS a non-duplicate error on the standalone (no-session) path,
      // {@link appendLedgerOrCompensate} also undoes the `$inc` before rethrowing
      // so the balance is never mutated without a matching ledger row.
      const applied = await this.appendLedgerOrCompensate(
        _id,
        coins,
        type,
        refId,
        updated.balanceCoins,
        session,
      );
      if (!applied) {
        const reverted = await this.compensateBalance(_id, -coins, session);
        return reverted;
      }

      // HOLD REPAYMENT: if the wallet is on an economy hold (an unpaid refund
      // debt), CONSUME this credit to repay the debt — debit the recovered
      // balance by `min(coins, heldCoins)` and append a matching `refund` ledger
      // row, drawing the debt down (and lifting the hold at zero). This keeps the
      // buyer from being made whole twice: the repaid value is removed from the
      // spendable balance, so `balanceCoins == Σ(ledger deltas)` stays true.
      await this.maybeReleaseHold(_id, coins, session);

      // Re-read the authoritative balance: maybeReleaseHold may have debited it
      // to repay the hold, so `updated.balanceCoins` (pre-repayment) is stale.
      const post = await this.walletModel
        .findOne({ userId: _id }, { balanceCoins: 1 }, session ? { session } : {})
        .lean()
        .exec();
      return post?.balanceCoins ?? updated.balanceCoins;
    });
  }

  /**
   * Reverse a previously-credited payment (refund / chargeback), recovering as
   * many coins as the balance still holds and recording any UNRECOVERED value as
   * an account DEBT under an economy hold.
   *
   * The naive "just debit the credited total back" reversal silently fails when
   * the buyer has already SPENT the coins: the guarded debit can't go negative,
   * throws insufficient-funds, and the caller swallows it — so the spent value
   * is kept for free. Instead we:
   *  1. claw back what's left: debit `min(balance, coins)` under a `refund`
   *     ledger row (idempotent on `refId`); and
   *  2. for the shortfall (`coins − reversed`) — the spent-and-now-owed value —
   *     set `economyHold: true` and add the shortfall to `heldCoins`, freezing
   *     the account from spending until the debt is repaid.
   *
   * `refId` is the namespaced refund key (e.g. `refund:<invoiceId>`) so the
   * clawback debit is idempotent against a redelivered refund webhook; the debt
   * mutation is keyed off the SAME refId so a redelivery does not double the debt.
   *
   * @returns `{ reversed, owed }` — coins actually clawed back, and the debt held.
   */
  async reverseRefund(
    userId: string,
    coins: number,
    refId: string,
  ): Promise<{ reversed: number; owed: number }> {
    this.assertPositiveInt(coins);
    const _id = new Types.ObjectId(userId);

    // CLAWBACK with a TOCTOU-safe retry. We read the balance and debit at most
    // `min(balance, coins)`, but a CONCURRENT user spend can land between the
    // read and the guarded debit, dropping the balance so the debit's
    // `balanceCoins >= coins` guard no longer matches and it throws
    // InsufficientFundsException. If we let that escape (or just swallow it) the
    // spent value is kept for free AND no debt is recorded — the very bug this
    // method exists to prevent. Instead we catch, RE-READ the now-lower balance,
    // and retry the clawback for whatever is still available, accumulating
    // `actuallyReversed`. The loop is bounded by `coins` retries (each retry
    // either recovers ≥1 coin or the balance is genuinely 0) so it always
    // terminates; we cap iterations defensively all the same.
    let actuallyReversed = 0;
    let remaining = coins;
    let attempts = 0;
    const maxAttempts = coins + 1;
    while (remaining > 0 && attempts < maxAttempts) {
      attempts += 1;
      const balance = await this.getBalance(userId);
      const reversible = Math.min(balance, remaining);
      if (reversible <= 0) {
        break; // nothing left to claw back — the rest is spent-and-owed debt.
      }
      try {
        // `refund` debits are exempt from the hold gate, so this claws back even
        // when the account is already on hold from an earlier short reversal.
        // refId is suffixed with the running tally so each partial clawback row
        // is a distinct, idempotent ledger entry under the unique (type, refId)
        // index (a single full clawback keeps the bare refId for back-compat).
        const clawRefId = actuallyReversed === 0 ? refId : `${refId}:claw${actuallyReversed}`;
        await this.debit(userId, reversible, 'refund', clawRefId);
        actuallyReversed += reversible;
        remaining -= reversible;
      } catch (err) {
        if (err instanceof InsufficientFundsException) {
          // A concurrent spend raced us below `reversible`. Re-read and retry for
          // the now-available amount; the InsufficientFundsException must NEVER
          // escape reverseRefund.
          this.logger.warn(
            `reverseRefund clawback for ${userId} (ref ${refId}) lost a race to a ` +
              `concurrent spend; re-reading balance and retrying (reversed so far ` +
              `${actuallyReversed}/${coins}).`,
          );
          continue;
        }
        throw err;
      }
    }

    // Whatever could NOT be clawed back is spent-and-now-owed value: ALWAYS
    // record it as debt and freeze spending, so a concurrent spend can never
    // leave the account un-frozen with an unrecorded debt. Keyed off the refund
    // refId so a redelivered refund webhook does not re-apply the debt.
    const owed = coins - actuallyReversed;
    if (owed > 0) {
      await this.applyEconomyHold(_id, owed, refId);
      this.logger.warn(
        `Refund of ${coins} coins for ${userId} (ref ${refId}) could only reverse ` +
          `${actuallyReversed}; held ${owed} as debt and froze spending (economyHold).`,
      );
    }

    return { reversed: actuallyReversed, owed };
  }

  /**
   * Atomically debit `coins` from a user's wallet (guarded by
   * `balanceCoins >= coins`) and append a ledger row. Returns the new balance.
   *
   * ECONOMY HOLD CHOKEPOINT: every user-initiated SPEND (gifts/top/covers) is
   * funnelled through here, so this is the single place to enforce the account
   * hold. When the wallet is on hold (`economyHold: true` — a refund/chargeback
   * left an unpaid debt), a spend debit is REFUSED with {@link EconomyHoldException}.
   * System REVERSALS (`type === 'refund'`, e.g. a refund clawing back coins) are
   * NOT gated, so the account can still be debited to recover a reversed payment
   * and ultimately clear its own hold.
   *
   * @throws EconomyHoldException (403) when the wallet is on hold and this is a
   *         user spend (any non-`refund` type).
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
    // A `refund` debit is a SYSTEM reversal/clawback (never a user spend), so it
    // is exempt from the hold gate — only user spends are frozen.
    const gatedByHold = type !== 'refund';

    return this.runWalletWrite(async (session) => {
      // Guarded single-document update: only matches when funds suffice AND (for a
      // user spend) the wallet is not on hold — so an overdraft is impossible and
      // a held account cannot spend, both atomically under concurrency.
      const updated = await this.walletModel
        .findOneAndUpdate(
          {
            userId: _id,
            balanceCoins: { $gte: coins },
            ...(gatedByHold ? { economyHold: { $ne: true } } : {}),
          },
          { $inc: { balanceCoins: -coins } },
          { new: true, ...(session ? { session } : {}) },
        )
        .exec();

      if (!updated) {
        // No document matched ⇒ no wallet, balance < coins, OR (for a spend) the
        // wallet is on hold. Distinguish the hold so the caller gets a 403 (not a
        // misleading 422) — re-read the wallet's hold flag for the spend case.
        if (gatedByHold && (await this.isOnHold(_id, session))) {
          throw new EconomyHoldException();
        }
        throw new InsufficientFundsException();
      }

      // Append the ledger row guarded by the unique `(type, refId)` index. A
      // duplicate means this debit was already applied (e.g. a redelivered
      // `Refund` webhook reversing the same invoice): undo the `$inc` and return
      // the unchanged balance so the debit happens AT MOST ONCE per refId. If the
      // append THROWS a non-duplicate error on the standalone (no-session) path,
      // {@link appendLedgerOrCompensate} also undoes the `$inc` before rethrowing
      // so the balance is never mutated without a matching ledger row.
      const applied = await this.appendLedgerOrCompensate(
        _id,
        -coins,
        type,
        refId,
        updated.balanceCoins,
        session,
      );
      if (!applied) {
        const reverted = await this.compensateBalance(_id, coins, session);
        return reverted;
      }
      return updated.balanceCoins;
    });
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * Append a single immutable ledger row reflecting a balance mutation.
   *
   * Returns `true` when the row was written, `false` when a row for this
   * (`type`, `refId`) already exists (duplicate-key on the partial unique
   * index) — i.e. the mutation was already applied and the caller must NOT
   * re-credit/-debit. With `refId: null` the unique index does not apply, so a
   * write always proceeds (returns `true`).
   *
   * The duplicate-key error is swallowed (not rethrown) so that inside a
   * transaction it does not abort the surrounding `withTransaction`; the caller
   * compensates the balance `$inc` it speculatively performed, keeping the net
   * effect zero. Any other error propagates.
   */
  private async appendLedger(
    userId: Types.ObjectId,
    delta: number,
    type: CoinTxType,
    refId: string | null,
    balanceAfter: number,
    session?: ClientSession,
  ): Promise<boolean> {
    try {
      await this.coinTxModel.create(
        [{ userId, delta, type, refId: refId ?? null, balanceAfter }],
        session ? { session } : {},
      );
      return true;
    } catch (err) {
      if (this.isDuplicateKeyError(err)) {
        this.logger.warn(
          `Idempotent skip: ledger row for (type=${type}, refId=${String(refId)}) already ` +
            'exists — the credit/debit was already applied; compensating the balance.',
        );
        return false;
      }
      throw err;
    }
  }

  /**
   * {@link appendLedger}, but additionally guaranteeing that a THROWN
   * (non-duplicate) ledger-insert error never leaves a mutated balance with no
   * matching audit row on the standalone (no-session) fallback path.
   *
   * On a replica set the work runs inside a transaction, so a thrown append
   * error aborts `withTransaction` and the speculative balance `$inc` rolls back
   * automatically — we MUST NOT compensate manually there (the rollback already
   * undoes it, and the session is aborting). We detect that path by the presence
   * of a `session` and simply rethrow.
   *
   * On a standalone Mongo there is no session: the balance `$inc` already
   * committed independently, so a thrown append would otherwise leave the
   * balance changed with no ledger row (the duplicate case is already handled by
   * {@link appendLedger} returning `false`). Here we compensate the just-applied
   * `$inc` (by `-delta`) and then rethrow the original error, keeping the net
   * balance effect zero and the wallet fully reconstructible from its ledger.
   *
   * @param delta the SIGNED balance change that was speculatively applied
   *        (positive for a credit, negative for a debit) — compensation reverses it.
   */
  private async appendLedgerOrCompensate(
    userId: Types.ObjectId,
    delta: number,
    type: CoinTxType,
    refId: string | null,
    balanceAfter: number,
    session?: ClientSession,
  ): Promise<boolean> {
    try {
      return await this.appendLedger(userId, delta, type, refId, balanceAfter, session);
    } catch (err) {
      // Transactional path: let the error abort the transaction (the $inc rolls
      // back with it). Compensating here would double-undo against an aborting
      // session.
      if (session) {
        throw err;
      }
      // Standalone path: the $inc already committed on its own. Undo it so the
      // balance is never left mutated without a matching ledger row.
      this.logger.error(
        `Ledger append failed for (type=${type}, refId=${String(refId)}) on the ` +
          'standalone path; compensating the balance to keep it in sync with the ledger: ' +
          `${(err as Error).message}`,
      );
      await this.compensateBalance(userId, -delta).catch((compErr: unknown) =>
        this.logger.error(
          `Failed to compensate balance after a ledger-append error for ` +
            `(type=${type}, refId=${String(refId)}): ${(compErr as Error).message}`,
        ),
      );
      throw err;
    }
  }

  /**
   * Reverse a speculative balance `$inc` when the ledger insert turned out to be
   * a duplicate (the mutation was already applied for this refId). Returns the
   * post-compensation balance (i.e. the balance WITHOUT this duplicate's effect).
   */
  private async compensateBalance(
    userId: Types.ObjectId,
    delta: number,
    session?: ClientSession,
  ): Promise<number> {
    const reverted = await this.walletModel
      .findOneAndUpdate(
        { userId },
        { $inc: { balanceCoins: delta } },
        { new: true, ...(session ? { session } : {}) },
      )
      .exec();
    return reverted?.balanceCoins ?? 0;
  }

  /**
   * Whether the wallet is currently under an economy hold (an unpaid refund
   * debt). Used by {@link debit} to distinguish a hold-block (403) from a plain
   * insufficient-funds non-match (422) when the guarded spend update finds no row.
   */
  private async isOnHold(userId: Types.ObjectId, session?: ClientSession): Promise<boolean> {
    const doc = await this.walletModel
      .findOne({ userId }, { economyHold: 1 }, session ? { session } : {})
      .lean()
      .exec();
    return doc?.economyHold === true;
  }

  /**
   * Record an unrecovered refund as DEBT and FREEZE the account: set
   * `economyHold: true` and add `owed` to the outstanding `heldCoins`. The debt
   * accumulates if multiple DISTINCT refunds go partly unrecovered.
   *
   * IDEMPOTENT per `refId` (P0): a redelivered refund webhook re-invokes
   * `reverseRefund` → `applyEconomyHold` with the SAME refId. The `$inc` is
   * guarded on `heldRefIds` NOT already containing this refId, and the refId is
   * `$addToSet`-ed in the same atomic update — so the debt is added AT MOST ONCE
   * per refId, mirroring the ledger's `(type, refId)` idempotency. A redelivery
   * matches nothing (refId already present) and is a no-op.
   *
   * Done in two atomic steps so the upsert (which can't carry the `$ne` guard
   * without risking a duplicate-key on a redelivery) and the guarded debt `$inc`
   * don't conflict: (1) ensure the wallet exists; (2) guarded idempotent `$inc`.
   */
  private async applyEconomyHold(
    userId: Types.ObjectId,
    owed: number,
    refId: string,
  ): Promise<void> {
    // (1) Ensure the wallet exists WITHOUT touching the debt counters, so the
    // guarded `$inc` below is the single authority on the debt and an upsert can
    // never race a duplicate-key against the `$ne`-guarded update on redelivery.
    await this.walletModel
      .findOneAndUpdate(
        { userId },
        { $setOnInsert: { userId } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();

    // (2) Guarded, idempotent debt application: only matches (and only `$inc`s)
    // when this refId has not yet contributed; record it so a redelivery no-ops.
    // `holdRefId` is captured so the repayment ledger rows can be namespaced.
    const updated = await this.walletModel
      .findOneAndUpdate(
        { userId, heldRefIds: { $ne: refId } },
        {
          $set: { economyHold: true, holdRefId: refId },
          $inc: { heldCoins: owed },
          $addToSet: { heldRefIds: refId },
        },
        { new: true },
      )
      .exec();

    if (!updated) {
      this.logger.warn(
        `Idempotent skip: economy-hold debt for (ref ${refId}) on wallet ` +
          `${userId.toString()} was already applied — not double-counting +${owed}.`,
      );
      return;
    }
    this.logger.warn(
      `Economy hold applied to wallet ${userId.toString()}: +${owed} debt (ref ${refId}).`,
    );
  }

  /**
   * Repay the economy-hold debt out of a fresh credit, CONSUMING the recovered
   * balance instead of merely wiping the flag. Called after a successful credit
   * with that credit's `creditDelta`.
   *
   * The bug this fixes: simply setting `economyHold:false, heldCoins:0` made the
   * buyer whole TWICE after a chargeback — the recovered coins stayed spendable
   * AND the debt vanished, so `balanceCoins != Σ(ledger deltas)`. The debt is
   * off-ledger value the buyer OWES, so repaying it must REMOVE that value from
   * the spendable balance and record it.
   *
   * Per credit we repay `repaid = min(creditDelta, heldCoins)` (PARTIAL
   * repayment across several credits is supported): atomically
   *  - DEBIT `balanceCoins` by `repaid` (guarded `>= repaid`; always satisfiable
   *    because the credit just added `creditDelta >= repaid` to the balance),
   *  - draw `heldCoins` DOWN by `repaid`, and clear the hold ONLY when it hits 0,
   *  - APPEND a `refund` ledger row (`delta = -repaid`, refId
   *    `holdrepay:<originalRefId>`) so the invariant keeps holding.
   *
   * All writes run inside the surrounding {@link runWalletWrite} envelope (the
   * `session`, when present). A no-op when the wallet isn't held.
   *
   * On the STANDALONE (no-session) path the repayment update commits on its own,
   * so if the ledger append then THROWS (a non-duplicate error) we restore the
   * full repayment — the `heldCoins` drawdown and the lifted-hold flags as well
   * as the balance debit — before rethrowing, so a failed append can never
   * silently understate the debt or un-freeze a debtor. On a replica set the
   * whole unit runs in a transaction, so a thrown append aborts and rolls
   * everything back atomically; we never restore manually there.
   */
  private async maybeReleaseHold(
    userId: Types.ObjectId,
    creditDelta: number,
    session?: ClientSession,
  ): Promise<void> {
    const held = await this.walletModel
      .findOne(
        { userId },
        { economyHold: 1, heldCoins: 1, holdRefId: 1, balanceCoins: 1 },
        session ? { session } : {},
      )
      .lean()
      .exec();
    if (!held || held.economyHold !== true) {
      return;
    }
    const debt = held.heldCoins ?? 0;
    const repaid = Math.min(creditDelta, debt);
    if (repaid <= 0) {
      return; // nothing repayable from this credit — stay frozen.
    }

    const remainingDebt = debt - repaid;
    const clears = remainingDebt === 0;
    // Namespace the repayment ledger row per the originating hold so it is unique
    // under the (type, refId) index; suffix with the running repaid tally so
    // MULTIPLE partial repayments of the same hold each get a distinct row.
    const base = held.holdRefId ?? userId.toString();
    const repayRefId = `holdrepay:${base}:${debt}`;

    // ATOMICALLY consume the recovered balance to repay the debt: debit the
    // balance, draw the debt down (clearing the hold only at zero) — guarded on
    // the still-held debt so a concurrent release can't double-spend the balance.
    const updated = await this.walletModel
      .findOneAndUpdate(
        {
          userId,
          economyHold: true,
          heldCoins: debt,
          balanceCoins: { $gte: repaid },
        },
        {
          $inc: { balanceCoins: -repaid, heldCoins: -repaid },
          ...(clears
            ? { $set: { economyHold: false, holdRefId: null }, $unset: { heldRefIds: '' } }
            : {}),
        },
        { new: true, ...(session ? { session } : {}) },
      )
      .exec();

    if (!updated) {
      // A concurrent credit/release already moved the debt; this credit's
      // repayment will be re-evaluated by that path. Nothing to undo (we did not
      // mutate the balance) — leave the spendable balance from THIS credit as-is.
      return;
    }

    // Reverse the speculative repayment update (the balance debit + debt
    // drawdown, and the lifted-hold flags when it cleared) so we don't repay the
    // same debt twice / leave a debtor un-frozen with no matching ledger row.
    const restoreRepayment = (): Promise<unknown> =>
      this.walletModel
        .findOneAndUpdate(
          { userId },
          {
            $inc: { balanceCoins: repaid, heldCoins: repaid },
            ...(clears ? { $set: { economyHold: true } } : {}),
          },
          { new: true, ...(session ? { session } : {}) },
        )
        .exec();

    // Append the matching ledger row so balanceCoins == Σ(ledger deltas). A
    // duplicate (idempotent redelivery hitting the same repayRefId) is undone by
    // compensating the debit we just made, keeping the net effect zero.
    //
    // STANDALONE PATH: the repayment findOneAndUpdate above committed
    // independently, so on a THROWN (non-duplicate) error appendLedgerOrCompensate
    // ALREADY restores the balance $inc (+repaid) for us — but it does NOT know
    // about the heldCoins drawdown or the lifted-hold flags this method applied
    // alongside. Restore ONLY those remaining pieces here (NOT the balance again —
    // that would double-restore) before letting the error propagate, so a thrown
    // append can't silently shrink the debt or un-freeze a debtor. On a replica
    // set the work runs in withTransaction, so a thrown append aborts and rolls
    // EVERYTHING back atomically — never restore manually there (it would
    // double-undo against an aborting session).
    let applied: boolean;
    try {
      applied = await this.appendLedgerOrCompensate(
        userId,
        -repaid,
        'refund',
        repayRefId,
        updated.balanceCoins,
        session,
      );
    } catch (err) {
      if (!session) {
        await this.walletModel
          .findOneAndUpdate(
            { userId },
            {
              // Balance was already restored by appendLedgerOrCompensate; restore
              // only the held-debt drawdown and the lifted-hold flags.
              $inc: { heldCoins: repaid },
              ...(clears ? { $set: { economyHold: true } } : {}),
            },
            { new: true },
          )
          .exec()
          .catch((restoreErr: unknown) =>
            this.logger.error(
              `Failed to restore the held-debt drawdown after a repayment ledger-append ` +
                `error for wallet ${userId.toString()} (ref ${repayRefId}): ` +
                `${(restoreErr as Error).message}`,
            ),
          );
      }
      throw err;
    }
    if (!applied) {
      // The repayment ledger row already exists — undo the debit+debt-drawdown
      // we speculatively applied so we don't repay the same debt twice.
      await restoreRepayment();
      return;
    }

    this.logger.log(
      `Economy-hold debt repaid for wallet ${userId.toString()}: -${repaid} from balance ` +
        `(remaining debt ${remainingDebt}${clears ? '; hold lifted' : '; still frozen'}).`,
    );
  }

  /** True for a MongoDB duplicate-key error (code 11000 / E11000). */
  private isDuplicateKeyError(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) {
      return false;
    }
    const code = (err as { code?: number | string }).code;
    const message = (err as { message?: string }).message ?? '';
    return code === 11000 || code === 11001 || /E11000 duplicate key/i.test(message);
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
