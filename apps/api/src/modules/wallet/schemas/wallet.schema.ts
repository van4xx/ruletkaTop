import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * A user's coin wallet — the single source of truth for spendable balance.
 *
 * Keyed 1:1 by `userId`. `balanceCoins` is a non-negative integer; the
 * non-negativity invariant is enforced atomically at write time by
 * {@link WalletService.debit} (a guarded `findOneAndUpdate`), and additionally
 * asserted here with `min: 0` as defence-in-depth.
 *
 * Every balance mutation is mirrored by an append-only {@link CoinTransaction}
 * ledger row so the wallet is fully auditable and reconstructible.
 */
@Schema({ collection: 'wallets', timestamps: true })
export class Wallet {
  /** Owning account. Unique — one wallet per user (index declared below). */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId!: Types.ObjectId;

  /** Spendable coin balance. Integer, never negative. */
  @Prop({ required: true, default: 0, min: 0, type: Number })
  balanceCoins!: number;

  /**
   * Account economy HOLD. Set when a refund/chargeback could not be fully
   * reversed because the buyer had already spent the credited coins — the
   * unrecovered value is recorded as debt in {@link heldCoins}. While `true`,
   * {@link WalletService.debit} refuses every user-initiated spend
   * (gifts/top/covers) at a single chokepoint, so the kept-for-free value cannot
   * be moved out of the account. Cleared automatically once the debt is repaid
   * (a later credit brings the balance back and the outstanding `heldCoins`
   * reaches zero). Defaults to `false` (no hold).
   */
  @Prop({ required: true, default: false, type: Boolean })
  economyHold!: boolean;

  /**
   * Outstanding refund/chargeback DEBT in coins: the portion of a reversed
   * payment that could not be clawed back because it had already been spent.
   * Non-negative. Increased when a short reversal sets {@link economyHold};
   * drawn down (and, at zero, the hold lifts) as the balance recovers and the
   * debt is repaid. Defaults to `0`.
   *
   * NOTE: `heldCoins` is NOT a ledger-backed balance — it is an off-ledger debt
   * COUNTER. The accounting invariant `balanceCoins == Σ(ledger deltas)` ignores
   * it. When the debt is repaid, the recovered `balanceCoins` is DEBITED and a
   * matching `refund` ledger row is written (see
   * {@link WalletService.maybeReleaseHold}) so the invariant keeps holding.
   */
  @Prop({ required: true, default: 0, min: 0, type: Number })
  heldCoins!: number;

  /**
   * Refund refIds that have ALREADY contributed to {@link heldCoins}. Used to
   * make the debt `$inc` IDEMPOTENT: a redelivered refund webhook re-invokes the
   * hold for the same refId, but the `$addToSet`/`$ne`-guarded update only adds
   * the debt the FIRST time the refId is seen — so a redelivery cannot double the
   * debt. Mirrors the ledger's at-most-once `(type, refId)` idempotency.
   */
  @Prop({ required: true, default: [], type: [String] })
  heldRefIds!: string[];

  /**
   * The originating refund refId whose unrecovered shortfall created the current
   * hold. Used to NAMESPACE the repayment ledger rows written as the debt is
   * drawn down (`holdrepay:<originalRefId>`), so each repayment row is unique and
   * the debt-clearing debits are themselves idempotent / auditable. `null` when
   * no hold is active.
   */
  @Prop({ required: false, default: null, type: String })
  holdRefId!: string | null;

  // `createdAt` / `updatedAt` added by `timestamps: true`.
}

export type WalletDocument = HydratedDocument<Wallet>;

export const WalletSchema = SchemaFactory.createForClass(Wallet);

// ── Indexes (PROJECT_SPEC §6) ──────────────────────────────────────────────
// One wallet per account, and the primary lookup / atomic-update key.
WalletSchema.index({ userId: 1 }, { unique: true });
// Leaderboard "coins" board ranks/counts by descending balance; without this
// the sort/count is a COLLSCAN + in-memory sort over every wallet. The index
// order serves `sort({ balanceCoins: -1 })` directly.
WalletSchema.index({ balanceCoins: -1 });
