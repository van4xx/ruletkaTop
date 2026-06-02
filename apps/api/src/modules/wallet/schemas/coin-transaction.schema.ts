import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import type { CoinTxType } from '@ruletka/shared-types';

/** Ledger entry kinds (kept in sync with `coinTxTypeSchema` in shared-types). */
const COIN_TX_TYPES: readonly CoinTxType[] = [
  'purchase',
  'gift_out',
  'gift_in',
  'top',
  'bonus',
  'refund',
];

/**
 * Append-only ledger row recording a single coin balance mutation.
 *
 * One row is written for every `credit`/`debit`, capturing the signed `delta`,
 * the `type` of operation, an optional `refId` (the originating entity:
 * gift-transaction id, top-placement id, payment invoice, …) and the
 * `balanceAfter` snapshot — so the wallet's history is fully auditable and any
 * balance is reconstructible by replaying the ledger.
 *
 * Rows are NEVER mutated or deleted; corrections are new (`refund`) rows.
 */
@Schema({ collection: 'cointransactions', timestamps: { createdAt: true, updatedAt: false } })
export class CoinTransaction {
  /** Account whose balance this row mutated. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId!: Types.ObjectId;

  /** Signed change in coins (positive for credit, negative for debit). */
  @Prop({ required: true, type: Number })
  delta!: number;

  /** What caused the mutation. */
  @Prop({ required: true, enum: COIN_TX_TYPES, type: String })
  type!: CoinTxType;

  /**
   * Optional reference to the originating entity (gift tx id, top placement id,
   * payment invoice id, …) for traceability/idempotency. `null` when none.
   */
  @Prop({ required: false, default: null, type: String })
  refId!: string | null;

  /** Wallet balance immediately AFTER applying this row's `delta`. */
  @Prop({ required: true, min: 0, type: Number })
  balanceAfter!: number;

  // `createdAt` added by `timestamps`; `updatedAt` disabled (rows are immutable).
}

export type CoinTransactionDocument = HydratedDocument<CoinTransaction>;

export const CoinTransactionSchema = SchemaFactory.createForClass(CoinTransaction);

// ── Indexes (PROJECT_SPEC §6) ──────────────────────────────────────────────
// Per-user ledger reads, newest first (history endpoint + reconciliation).
CoinTransactionSchema.index({ userId: 1, createdAt: -1 });
