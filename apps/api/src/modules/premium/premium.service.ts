import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';

import type {
  PremiumPlan as PremiumPlanContract,
  Subscription as SubscriptionContract,
} from '@ruletka/shared-types';

import { CloudPaymentsClient } from '../payments/cloudpayments.client';
import { PremiumPlan, PremiumPlanDocument } from './schemas/premium-plan.schema';
import { Subscription, SubscriptionDocument } from './schemas/subscription.schema';

/**
 * Default premium plans seeded on boot (idempotent upsert by `code`).
 */
const SEED_PLANS: readonly PremiumPlanContract[] = [
  {
    code: 'monthly',
    title: 'Premium Monthly',
    priceRub: 399,
    intervalDays: 30,
    perks: [
      'Unlimited matches',
      'Gender & country filters',
      'Premium-only gifts',
      'Ad-free experience',
      'Premium badge',
    ],
  },
  {
    code: 'yearly',
    title: 'Premium Yearly',
    priceRub: 3499,
    intervalDays: 365,
    perks: ['Everything in Monthly', '2 months free vs monthly', 'Priority matchmaking'],
  },
];

/**
 * Owns subscription state and is the authority on premium entitlement.
 *
 * EXPORTED from {@link PremiumModule} and consumed by `gifts` (gating
 * premium-only gifts), `matchmaking` (premium filters) and `payments`
 * (activate/cancel on webhook). Structurally implements the payments-side
 * `PremiumServiceContract` (`isPremium` / `activate` / `cancel`) so the
 * integrator can bind it to the `PREMIUM_SERVICE` token via `useExisting`.
 *
 * ── Profile coupling ──────────────────────────────────────────────────────
 * Activation/cancellation must mirror `isPremium` / `premiumUntil` (and the
 * `premium` badge) onto the user's `profiles` document for cheap rendering.
 * Rather than importing `ProfilesModule` (which would couple module load order
 * across parallel-built feature dirs), this writes the `profiles` collection
 * directly by name via the shared connection — the same decoupling pattern the
 * profiles module itself uses to read `gifttransactions`. INTEGRATOR NOTE: this
 * assumes the `profiles` collection name is stable (it is, per Profile schema).
 */
@Injectable()
export class PremiumService implements OnModuleInit {
  private readonly logger = new Logger(PremiumService.name);

  constructor(
    @InjectModel(PremiumPlan.name)
    private readonly planModel: Model<PremiumPlanDocument>,
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<SubscriptionDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly cloudPayments: CloudPaymentsClient,
  ) {}

  /** Idempotently seed the default plans (upsert by unique `code`). */
  async onModuleInit(): Promise<void> {
    await Promise.all(
      SEED_PLANS.map((plan) =>
        this.planModel
          .updateOne({ code: plan.code }, { $setOnInsert: plan }, { upsert: true })
          .exec(),
      ),
    );
    this.logger.log(`Seeded ${SEED_PLANS.length} premium plans (idempotent)`);
  }

  /** List all premium plans (cheapest first) as the shared contract shape. */
  async findAllPlans(): Promise<PremiumPlanContract[]> {
    const docs = await this.planModel.find().sort({ priceRub: 1 }).lean().exec();
    return docs.map((doc) => this.toPlanContract(doc));
  }

  /** Resolve a plan by its public `code`, or `null` when unknown. */
  async findPlanByCode(code: string): Promise<PremiumPlanContract | null> {
    const doc = await this.planModel.findOne({ code }).lean().exec();
    return doc ? this.toPlanContract(doc) : null;
  }

  /**
   * Whether a user currently holds premium: an `active` subscription whose
   * `currentPeriodEnd` is still in the future.
   */
  async isPremium(userId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId)) {
      return false;
    }
    const doc = await this.subscriptionModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .select('status currentPeriodEnd')
      .lean()
      .exec();
    return this.entitled(doc?.status, doc?.currentPeriodEnd ?? null);
  }

  /**
   * Whether the user has flagged their subscription to NOT renew. The payments
   * Recurrent webhook consults this so a renewal charge can never silently
   * re-activate a subscription the user already cancelled.
   */
  async hasCanceledRenewal(userId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId)) {
      return false;
    }
    const doc = await this.subscriptionModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .select('status cancelAtPeriodEnd')
      .lean()
      .exec();
    if (!doc) {
      return false;
    }
    return doc.cancelAtPeriodEnd === true || doc.status === 'canceled';
  }

  /**
   * Activate (or extend) premium for a user through to `currentPeriodEnd`.
   *
   * Upserts the subscription to `active`, records `startedAt` on first
   * activation, optionally persists the recurring-charge `token`, clears any
   * pending cancellation, and mirrors entitlement onto the profile.
   *
   * @param plan plan code (e.g. `monthly`).
   * @param currentPeriodEnd end of the paid period (entitlement window).
   * @param token optional CloudPayments recurring-charge token.
   * @param subscriptionId optional CloudPayments subscription id (persisted so a
   *        later user cancellation can stop billing upstream).
   */
  async activate(
    userId: string,
    plan: string,
    currentPeriodEnd: Date,
    token?: string,
    subscriptionId?: string,
  ): Promise<void> {
    const _id = new Types.ObjectId(userId);

    const set: Record<string, unknown> = {
      plan,
      status: 'active',
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
    };
    if (token !== undefined) {
      set.token = token;
    }
    if (subscriptionId !== undefined) {
      set.subscriptionId = subscriptionId;
    }

    await this.subscriptionModel
      .updateOne(
        { userId: _id },
        {
          $set: set,
          // Stamp the start only when the record is first created.
          $setOnInsert: { userId: _id, startedAt: new Date() },
        },
        { upsert: true },
      )
      .exec();

    // Ensure `startedAt` exists even when re-activating an old (null) record.
    await this.subscriptionModel
      .updateOne({ userId: _id, startedAt: null }, { $set: { startedAt: new Date() } })
      .exec();

    await this.syncProfilePremium(_id, true, currentPeriodEnd);
  }

  /**
   * Cancel a user's subscription: mark it `canceled` and flag it to lapse at
   * period end. Access is retained until `currentPeriodEnd` (standard SaaS
   * behaviour), so the profile mirror is recomputed from the still-current
   * period rather than revoked outright.
   *
   * For immediate revocation (e.g. a refund), the caller should additionally
   * move `currentPeriodEnd` into the past before/after calling this.
   */
  async cancel(userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      return;
    }
    const _id = new Types.ObjectId(userId);

    const doc = await this.subscriptionModel
      .findOneAndUpdate(
        { userId: _id },
        { $set: { status: 'canceled', cancelAtPeriodEnd: true } },
        { new: true },
      )
      .select('currentPeriodEnd')
      .exec();

    // Recompute the profile mirror: still premium iff the paid period is in the
    // future; otherwise revoke (false, null).
    const periodEnd = doc?.currentPeriodEnd ?? null;
    const stillEntitled = periodEnd !== null && periodEnd.getTime() > Date.now();
    await this.syncProfilePremium(_id, stillEntitled, stillEntitled ? periodEnd : null);
  }

  /**
   * User-initiated cancellation: actually STOP future billing at CloudPayments
   * (so no further recurring charge is attempted), then flip local state via
   * {@link cancel}. Access is retained until `currentPeriodEnd` (standard SaaS).
   *
   * This is distinct from {@link cancel}, which only mutates local state and is
   * used by the webhook/refund paths (where the provider already stopped
   * billing). Here WE are the initiator, so we must reach out to the provider.
   *
   * The upstream cancel is best-effort: if it fails (e.g. keys unset, or a
   * transient provider error) we still record the local cancellation so the UI
   * reflects intent — but we LOG the failure loudly, because a silent failure
   * would mean the card keeps getting charged. The defence-in-depth backstop is
   * {@link PaymentsService.handleRecurrent}, which refuses to re-activate a
   * subscription the user has flagged `cancelAtPeriodEnd`.
   */
  async cancelAtPeriodEnd(userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      return;
    }
    const _id = new Types.ObjectId(userId);

    // Pull the (server-only) CloudPayments subscription id to cancel upstream.
    const doc = await this.subscriptionModel
      .findOne({ userId: _id })
      .select('+subscriptionId')
      .lean()
      .exec();

    const subscriptionId = (doc as { subscriptionId?: string | null } | null)?.subscriptionId;
    if (subscriptionId && this.cloudPayments.isConfigured()) {
      try {
        await this.cloudPayments.cancelSubscription(subscriptionId);
        this.logger.log(`Cancelled CloudPayments subscription ${subscriptionId} for user ${userId}`);
      } catch (err) {
        // Do NOT swallow silently into success — billing may continue. Surface
        // it in logs; local state is still flipped below so the user sees intent.
        this.logger.error(
          `Failed to cancel CloudPayments subscription ${subscriptionId} for user ${userId}: ${
            (err as Error).message
          }. Local cancellation recorded; recurrent webhook is the backstop.`,
        );
      }
    } else if (subscriptionId) {
      this.logger.warn(
        `User ${userId} cancelled but CloudPayments is not configured — cannot stop upstream billing for subscription ${subscriptionId}`,
      );
    }

    // Flip local state + recompute the profile mirror (retains access to period end).
    await this.cancel(userId);
  }

  /**
   * EXPIRY SWEEP (called by the repeatable BullMQ job): terminate every
   * subscription whose paid period has elapsed — both lapsed-but-active records
   * (a renewal that never came) and `canceled` ones that have now reached period
   * end. Moves them to the non-entitled `none` state, stamps `cancelAtPeriodEnd`
   * off, and revokes the profile premium mirror.
   *
   * Idempotent + safe to run on any cadence: it only matches rows that are still
   * entitlement-bearing yet past their `currentPeriodEnd`, so a second pass is a
   * no-op. Returns the number of subscriptions expired (for logging/metrics).
   */
  async sweepExpired(now: Date = new Date()): Promise<number> {
    // Candidates: still in an entitlement-bearing state but past period end.
    const expiring = await this.subscriptionModel
      .find({
        status: { $in: ['active', 'canceled', 'past_due'] },
        currentPeriodEnd: { $ne: null, $lte: now },
      })
      .select('userId')
      .lean()
      .exec();

    if (expiring.length === 0) {
      return 0;
    }

    const ids = expiring.map((d) => d._id);
    await this.subscriptionModel
      .updateMany(
        { _id: { $in: ids } },
        { $set: { status: 'none', cancelAtPeriodEnd: false } },
      )
      .exec();

    // Revoke the profile premium mirror for each expired subscriber.
    await Promise.all(
      expiring.map((d) =>
        this.syncProfilePremium(d.userId as Types.ObjectId, false, null),
      ),
    );

    this.logger.log(`Expiry sweep: marked ${expiring.length} subscription(s) expired`);
    return expiring.length;
  }

  /**
   * READ-ONLY fetch of a user's subscription in the shared contract shape. Never
   * writes: if no record exists yet, a synthetic `none` subscription is returned
   * so `GET /premium/subscription` is a pure read (unlike {@link getSubscription},
   * which lazily upserts). Returns `null` for an invalid id.
   */
  async getSubscriptionState(userId: string): Promise<SubscriptionContract | null> {
    if (!Types.ObjectId.isValid(userId)) {
      return null;
    }
    const _id = new Types.ObjectId(userId);
    const doc = await this.subscriptionModel.findOne({ userId: _id }).exec();
    if (doc) {
      return this.toSubscriptionContract(doc);
    }
    // No record yet — return a synthetic, un-persisted `none` subscription.
    return {
      id: _id.toString(),
      userId: _id.toString(),
      plan: 'none',
      status: 'none',
      startedAt: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    };
  }

  /**
   * Fetch a user's subscription in the shared contract shape, lazily
   * materialising a `none` record on first read so the surface is never empty.
   */
  async getSubscription(userId: string): Promise<SubscriptionContract> {
    const _id = new Types.ObjectId(userId);
    const doc = await this.subscriptionModel
      .findOneAndUpdate(
        { userId: _id },
        { $setOnInsert: { userId: _id } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this.toSubscriptionContract(doc);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** Entitlement predicate: `active` and not yet expired. */
  private entitled(status: string | undefined, currentPeriodEnd: Date | null): boolean {
    return (
      status === 'active' && currentPeriodEnd !== null && currentPeriodEnd.getTime() > Date.now()
    );
  }

  /**
   * Mirror premium entitlement onto the user's profile document. Writes by
   * collection name to avoid a hard module dependency (see class docs). Adds or
   * removes the `premium` badge accordingly. Best-effort: a missing profile
   * simply matches nothing.
   */
  private async syncProfilePremium(
    userId: Types.ObjectId,
    isPremium: boolean,
    premiumUntil: Date | null,
  ): Promise<void> {
    try {
      const update: Record<string, unknown> = {
        $set: { isPremium, premiumUntil },
      };
      if (isPremium) {
        update.$addToSet = { badges: 'premium' };
      } else {
        update.$pull = { badges: 'premium' };
      }
      await this.connection.collection('profiles').updateOne({ userId }, update);
    } catch (err) {
      // Never let a denormalisation hiccup fail the authoritative write.
      this.logger.error(
        `Failed to sync premium flag onto profile ${userId.toString()}: ${(err as Error).message}`,
      );
    }
  }

  /** Project a (lean) plan document to the shared contract shape. */
  private toPlanContract(
    doc: Pick<PremiumPlan, 'code' | 'title' | 'priceRub' | 'intervalDays' | 'perks'>,
  ): PremiumPlanContract {
    return {
      code: doc.code,
      title: doc.title,
      priceRub: doc.priceRub,
      intervalDays: doc.intervalDays,
      perks: doc.perks,
    };
  }

  /** Map a hydrated subscription document to the shared contract shape. */
  private toSubscriptionContract(doc: SubscriptionDocument): SubscriptionContract {
    return {
      id: doc._id.toString(),
      userId: doc.userId.toString(),
      plan: doc.plan,
      status: doc.status,
      startedAt: doc.startedAt ? doc.startedAt.toISOString() : null,
      currentPeriodEnd: doc.currentPeriodEnd ? doc.currentPeriodEnd.toISOString() : null,
      cancelAtPeriodEnd: doc.cancelAtPeriodEnd,
    };
  }
}
