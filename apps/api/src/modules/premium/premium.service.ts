import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';

import type {
  PremiumPlan as PremiumPlanContract,
  Subscription as SubscriptionContract,
} from '@ruletka/shared-types';

import {
  PremiumPlan,
  PremiumPlanDocument,
} from './schemas/premium-plan.schema';
import {
  Subscription,
  SubscriptionDocument,
} from './schemas/subscription.schema';

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
    perks: [
      'Everything in Monthly',
      '2 months free vs monthly',
      'Priority matchmaking',
    ],
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
   * Activate (or extend) premium for a user through to `currentPeriodEnd`.
   *
   * Upserts the subscription to `active`, records `startedAt` on first
   * activation, optionally persists the recurring-charge `token`, clears any
   * pending cancellation, and mirrors entitlement onto the profile.
   *
   * @param plan plan code (e.g. `monthly`).
   * @param currentPeriodEnd end of the paid period (entitlement window).
   * @param token optional CloudPayments recurring-charge token.
   */
  async activate(
    userId: string,
    plan: string,
    currentPeriodEnd: Date,
    token?: string,
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
      .updateOne(
        { userId: _id, startedAt: null },
        { $set: { startedAt: new Date() } },
      )
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
  private entitled(
    status: string | undefined,
    currentPeriodEnd: Date | null,
  ): boolean {
    return (
      status === 'active' &&
      currentPeriodEnd !== null &&
      currentPeriodEnd.getTime() > Date.now()
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
      await this.connection
        .collection('profiles')
        .updateOne({ userId }, update);
    } catch (err) {
      // Never let a denormalisation hiccup fail the authoritative write.
      this.logger.error(
        `Failed to sync premium flag onto profile ${userId.toString()}: ${
          (err as Error).message
        }`,
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
