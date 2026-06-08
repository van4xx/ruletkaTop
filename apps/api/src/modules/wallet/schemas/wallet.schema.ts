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
