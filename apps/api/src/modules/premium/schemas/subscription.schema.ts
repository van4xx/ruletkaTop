import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import type { PremiumTier, SubscriptionStatus } from '@ruletka/shared-types';

/** Subscription lifecycle states (kept in sync with `subscriptionStatusSchema`). */
const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'active',
  'canceled',
  'past_due',
  'none',
];

/** Two-tier split (kept in sync with `premiumTierSchema` in shared-types). */
const PREMIUM_TIERS: readonly PremiumTier[] = ['lite', 'pro'];

/**
 * A user's premium subscription record, keyed 1:1 by `userId`.
 *
 * `status` + `currentPeriodEnd` together define entitlement: a user is premium
 * iff `status === 'active' && currentPeriodEnd > now`. The economy/payments
 * domain is authoritative; the `profiles` document mirrors `isPremium` /
 * `premiumUntil` for cheap rendering (kept in sync by {@link PremiumService}).
 */
@Schema({ collection: 'subscriptions', timestamps: true })
export class Subscription {
  /** Owning account. Unique — one subscription record per user (index below). */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId!: Types.ObjectId;

  /** Plan code (references {@link PremiumPlan.code}). */
  @Prop({ required: true, default: 'none', type: String })
  plan!: string;

  /** Current lifecycle state. */
  @Prop({ required: true, enum: SUBSCRIPTION_STATUSES, default: 'none', type: String })
  status!: SubscriptionStatus;

  /**
   * CloudPayments recurring-charge token used to bill renewals. SERVER-ONLY:
   * `select: false` so it is never loaded into the public projection or logged.
   */
  @Prop({ required: false, default: null, select: false, type: String })
  token!: string | null;

  /**
   * CloudPayments subscription id (set once the provider creates a recurring
   * subscription). Needed to CANCEL billing upstream when the user cancels.
   * SERVER-ONLY (`select: false`) — never part of the public projection.
   */
  @Prop({ required: false, default: null, select: false, type: String })
  subscriptionId!: string | null;

  /** When the (most recent) subscription period began, or `null`. */
  @Prop({ required: false, default: null, type: Date })
  startedAt!: Date | null;

  /** End of the currently-paid period, or `null` when not subscribed. */
  @Prop({ required: false, default: null, type: Date })
  currentPeriodEnd!: Date | null;

  /** Whether the subscription will lapse (not renew) at period end. */
  @Prop({ required: true, default: false })
  cancelAtPeriodEnd!: boolean;

  /**
   * Two-tier split — `'lite'` (historical baseline) or `'pro'` (higher tier).
   * Defaults to `'lite'` so pre-split rows are treated as legacy premium
   * without a backfill. Painted by {@link PremiumService.activate} from the
   * plan code (`tierForPlanCode`); read by every tier-gated feature via
   * {@link PremiumService.getEffectiveTier}.
   */
  @Prop({ required: true, enum: PREMIUM_TIERS, default: 'lite', type: String })
  tier!: PremiumTier;

  // `createdAt` / `updatedAt` added by `timestamps: true`.
}

export type SubscriptionDocument = HydratedDocument<Subscription>;

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);

// ── Indexes (PROJECT_SPEC §6) ──────────────────────────────────────────────
// One subscription per account, and the primary lookup key.
SubscriptionSchema.index({ userId: 1 }, { unique: true });
// Renewal sweeps / entitlement queries by state and expiry.
SubscriptionSchema.index({ status: 1, currentPeriodEnd: 1 });
