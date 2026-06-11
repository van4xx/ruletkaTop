import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import {
  REFERRAL_CODE_LENGTH,
  REFERRAL_LIFETIME_CAP_COINS,
  REFERRAL_TIER_BPS,
  lifetimeReferralCapFor,
  type PaginationMeta,
  type ReferralDownlineEntry,
  type ReferralLookupResponse,
  type ReferralMeResponse,
  type ReferralStats,
  type ReferralTier,
} from '@ruletka/shared-types';

import { PremiumService } from '../premium/premium.service';
import { Profile, ProfileDocument } from '../profiles/schemas/profile.schema';
import {
  CoinTransaction,
  CoinTransactionDocument,
} from '../wallet/schemas/coin-transaction.schema';
import { WalletService } from '../wallet/wallet.service';
import { ReferralEdge, ReferralEdgeDocument } from './schemas/referral-edge.schema';
import { ReferralLink, ReferralLinkDocument } from './schemas/referral-link.schema';

/** Mongo duplicate-key code (E11000) — the per-invitee unique edge collides on rebind. */
const DUPLICATE_KEY_CODE = 11000;

/** Chars in the generated code — 32 unambiguous symbols (no `0/O/1/I/L`). */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * Public base URL used to assemble the shareable link. Falls back to the
 * production domain when the env var is missing — the link is a server-rendered
 * convenience; the only authoritative artefact is the `code` itself.
 */
const DEFAULT_PUBLIC_ORIGIN = 'https://ruletka.top';

/**
 * One UPPER-CASE alphanumeric tier identifier per row (T1/T2/T3) embedded in
 * the wallet `refId` so a redelivered sweep or webhook is idempotent per
 * (tier, purchaserId, purchaseLedgerId) — the wallet's partial-unique
 * `(type, refId)` index does the rest.
 */
function tierRefId(tier: ReferralTier, purchaserId: string, purchaseLedgerId: string): string {
  return `referral-reward:T${tier}:${purchaserId}:${purchaseLedgerId}`;
}

/**
 * Owns the `referrallinks` + `referraledges` collections and the per-purchase
 * reward chain.
 *
 * ── Chain walk ────────────────────────────────────────────────────────────
 * `bind` walks UP the inviter's chain at most TWO steps so an invitee earns
 * exactly THREE edges: (Alice→Bob, T1), (Carol→Bob, T2), (Dave→Bob, T3).
 *
 * ── Reward fan-out ────────────────────────────────────────────────────────
 * `creditPurchaseRewards` reads the up to three edges for `purchaserId` and
 * credits each inviter with `purchaseCoins * REFERRAL_TIER_BPS[tier] / 10_000`
 * coins through {@link WalletService.credit} with a namespaced refId so a
 * redelivered call is a clean no-op. The denormalised `totalEarnedCoins` on the
 * inviter's `ReferralLink` is bumped in the same call, with a per-inviter
 * lifetime cap so a small number of whales can't pump a single inviter
 * forever.
 *
 * ── First-purchase gate (T1 anti-bot) ─────────────────────────────────────
 * The first time `creditPurchaseRewards` lands for an invitee we ALSO flip
 * their canonical T1 row's `hasMadeFirstPurchase` from `false → true`. Crucially
 * the gate is enforced per CHAIN STEP independently: T1 (the direct inviter)
 * only earns AFTER the gate flips — pre-gate purchases earn nothing for T1,
 * so a registered-but-never-bought account is useless to a bot farm. T2/T3
 * still earn on those pre-gate purchases (they didn't bring the user in) but
 * the gate matters specifically for the abuse target.
 */
@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    @InjectModel(ReferralLink.name)
    private readonly linkModel: Model<ReferralLinkDocument>,
    @InjectModel(ReferralEdge.name)
    private readonly edgeModel: Model<ReferralEdgeDocument>,
    @InjectModel(Profile.name)
    private readonly profileModel: Model<ProfileDocument>,
    @InjectModel(CoinTransaction.name)
    private readonly coinTxModel: Model<CoinTransactionDocument>,
    private readonly walletService: WalletService,
    private readonly premiumService: PremiumService,
    @Optional() private readonly publicOriginOverride?: string,
  ) {}

  // ─────────────────────────── Link ───────────────────────────

  /**
   * Lazily materialise the caller's referral link. Idempotent: a repeat call
   * converges on the SAME row (unique on `userId`). On a code collision (one in
   * ~10^12) we retry with a fresh code until the upsert sticks.
   */
  async ensureLink(userId: string): Promise<ReferralLinkDocument> {
    const _id = new Types.ObjectId(userId);
    // Fast path: already exists.
    const existing = await this.linkModel.findOne({ userId: _id }).exec();
    if (existing) {
      return existing;
    }
    // Bounded retry on the (vanishingly unlikely) code collision.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = this.generateCode();
      try {
        return await this.linkModel.create({
          userId: _id,
          code,
          totalSignups: 0,
          totalEarnedCoins: 0,
        });
      } catch (err) {
        if (this.isDuplicateKeyError(err)) {
          // Could be either userId race (another concurrent ensureLink) or code
          // collision — re-read the userId row first.
          const raced = await this.linkModel.findOne({ userId: _id }).exec();
          if (raced) {
            return raced;
          }
          // Otherwise it was a code collision: retry with a new code.
          continue;
        }
        throw err;
      }
    }
    throw new Error('Failed to generate a unique referral code after 5 attempts');
  }

  /** Read the caller's `/referrals/me` envelope (link + downline aggregates). */
  async getMe(userId: string): Promise<ReferralMeResponse> {
    const link = await this.ensureLink(userId);
    const stats = await this.computeStats(userId, link.totalEarnedCoins);
    const origin = this.publicOriginOverride ?? process.env.PUBLIC_WEB_ORIGIN ?? DEFAULT_PUBLIC_ORIGIN;
    return {
      code: link.code,
      link: `${origin.replace(/\/$/, '')}/register?ref=${link.code}`,
      stats,
    };
  }

  /**
   * Public, unauthenticated lookup of a code → "valid? + inviter nickname".
   * Returns `valid: false` for an unknown code (NOT 404) so the register
   * surface always renders, even with a stale/forged `?ref=`.
   */
  async lookupCode(code: string): Promise<ReferralLookupResponse> {
    const normalized = this.normalizeCode(code);
    if (!normalized) {
      return { valid: false };
    }
    const link = await this.linkModel.findOne({ code: normalized }).lean().exec();
    if (!link) {
      return { valid: false };
    }
    const profile = await this.profileModel
      .findOne({ userId: link.userId })
      .select('nickname')
      .lean()
      .exec();
    if (!profile) {
      // Link exists but the inviter's profile is gone (deleted account etc.).
      return { valid: false };
    }
    return { valid: true, inviterNickname: profile.nickname };
  }

  // ─────────────────────────── Binding ───────────────────────────

  /**
   * Bind `inviteeId` to the owner of `code`. Performs the canonical chain walk
   * UP from the inviter and inserts up to three edges in tier order (T1, T2,
   * T3) — each insert is independent so a partial chain (e.g. the inviter has
   * no inviter themselves) still produces a T1 edge.
   *
   * Throws:
   *  - 400 on a malformed code or a self-referral attempt,
   *  - 404 on an unknown code,
   *  - 409 when the invitee is already bound (per-invitee unique on T1).
   */
  async bind(inviteeId: string, code: string): Promise<void> {
    const normalized = this.normalizeCode(code);
    if (!normalized) {
      throw new BadRequestException('Invalid referral code');
    }
    const link = await this.linkModel.findOne({ code: normalized }).lean().exec();
    if (!link) {
      throw new BadRequestException('Unknown referral code');
    }
    const inviterId = link.userId.toString();
    if (inviterId === inviteeId) {
      throw new BadRequestException('Cannot refer yourself');
    }

    // Walk the chain up to two more steps to derive T2 + T3 (T1 is the bare
    // inviter). The order is significant: T1 MUST be inserted first because
    // the per-invitee unique partial index lives on tier=1 — its E11000 is the
    // "already bound" 409.
    const tier2 = await this.findInviterOf(inviterId);
    const tier3 = tier2 ? await this.findInviterOf(tier2) : null;

    const chain: Array<{ inviter: string; tier: ReferralTier }> = [
      { inviter: inviterId, tier: 1 },
    ];
    if (tier2 && tier2 !== inviteeId) {
      chain.push({ inviter: tier2, tier: 2 });
    }
    if (tier3 && tier3 !== inviteeId && tier3 !== inviterId) {
      chain.push({ inviter: tier3, tier: 3 });
    }

    for (const { inviter, tier } of chain) {
      try {
        await this.edgeModel.create({
          inviterId: new Types.ObjectId(inviter),
          inviteeId: new Types.ObjectId(inviteeId),
          tier,
          hasMadeFirstPurchase: false,
        });
        if (tier === 1) {
          // Denormalised counter on the inviter's link doc — survives a recount
          // because the row is reconstructible from the edges collection.
          await this.linkModel
            .updateOne(
              { userId: new Types.ObjectId(inviter) },
              { $inc: { totalSignups: 1 } },
              { upsert: false },
            )
            .exec();
        }
      } catch (err) {
        if (this.isDuplicateKeyError(err)) {
          // T1 duplicate = invitee already bound → product-level conflict.
          if (tier === 1) {
            throw new ConflictException('Already bound to a referrer');
          }
          // T2/T3 duplicates (vanishingly unlikely — the inviteeId-only unique
          // index is partial on tier=1) just no-op for safety.
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * Look up the inviter (T1) of `userId`, or `null` when none. Used by the
   * chain walker — single indexed lookup.
   */
  private async findInviterOf(userId: string): Promise<string | null> {
    const row = await this.edgeModel
      .findOne({ inviteeId: new Types.ObjectId(userId), tier: 1 })
      .select('inviterId')
      .lean()
      .exec();
    return row?.inviterId.toString() ?? null;
  }

  // ─────────────────────────── Rewards ───────────────────────────

  /**
   * Fan out a referral reward across the up-to-three inviters of `purchaserId`
   * for ONE coin purchase ledger row. Each tier credits independently — a
   * missing T2/T3 is fine; a missing T1 is "no inviter, nothing to do".
   *
   * IDEMPOTENT per `(tier, purchaserId, purchaseLedgerId)`: the wallet's
   * partial-unique `(type, refId)` ledger index makes a repeat call (sweeper
   * re-pass / webhook redelivery / restart) a clean no-op.
   *
   * The denormalised `totalEarnedCoins` cap on the INVITER stops crediting
   * once it would cross {@link REFERRAL_LIFETIME_CAP_COINS} — partial credits
   * fill exactly to the cap, the overflow is dropped.
   *
   * @param purchaserId  the invitee whose purchase triggered the reward
   * @param purchaseCoins coins purchased (delta of the `purchase` ledger row;
   *        the bonus-included total credited to the wallet)
   * @param purchaseLedgerId the originating `cointransactions._id` — the
   *        idempotency key embedded in each tier's wallet refId
   */
  async creditPurchaseRewards(
    purchaserId: string,
    purchaseCoins: number,
    purchaseLedgerId: string,
  ): Promise<{ credited: Array<{ tier: ReferralTier; inviterId: string; coins: number }> }> {
    if (purchaseCoins <= 0 || !Number.isInteger(purchaseCoins)) {
      return { credited: [] };
    }
    const _id = new Types.ObjectId(purchaserId);
    const edges = await this.edgeModel
      .find({ inviteeId: _id })
      .select('inviterId tier hasMadeFirstPurchase')
      .lean()
      .exec();

    const credited: Array<{ tier: ReferralTier; inviterId: string; coins: number }> = [];

    // Read the canonical T1 row once so we know the gate state and can flip it
    // after the wallet credit lands (single source of truth: only the T1 row
    // is mutated, T2/T3 rows are append-only).
    const t1Edge = edges.find((e) => e.tier === 1);
    const t1AlreadyFlipped = t1Edge?.hasMadeFirstPurchase === true;

    for (const edge of edges) {
      const tier = edge.tier as ReferralTier;
      const bps = REFERRAL_TIER_BPS[tier];
      // T1 reward is gated on first-purchase: the direct inviter only starts
      // earning AFTER the canonical T1 row flips. The flip lands BELOW after
      // this loop, so the very first purchase produces NO T1 credit on
      // purpose — that's the anti-bot floor: a referred account must actually
      // buy something before T1 starts paying out.
      if (tier === 1 && !t1AlreadyFlipped) {
        continue;
      }
      // Integer math — coins are integers, bps is the rate * 10_000.
      const reward = Math.floor((purchaseCoins * bps) / 10_000);
      if (reward <= 0) {
        continue;
      }
      const inviterId = edge.inviterId.toString();
      // Cap gate: STOP crediting once the inviter is at/above the lifetime
      // ceiling. We READ the latest counter just before each tier's credit
      // (cheap indexed read) so back-to-back sweeps can't blow past the cap.
      const [link, inviterTier] = await Promise.all([
        this.linkModel
          .findOne({ userId: edge.inviterId })
          .select('totalEarnedCoins')
          .lean()
          .exec(),
        // Per-tier cap — Pro raises the ceiling from 5000 → 20000 lifetime
        // (see `lifetimeReferralCapFor`). Read AT CREDIT TIME so a tier change
        // takes effect on the very next reward (a downgrade re-clamps).
        this.premiumService.getEffectiveTier(inviterId),
      ]);
      const earned = link?.totalEarnedCoins ?? 0;
      const tierCap = lifetimeReferralCapFor(inviterTier);
      if (earned >= tierCap) {
        this.logger.debug(
          `Skipping T${tier} reward for inviter ${inviterId}: lifetime cap reached (${earned}/${tierCap}, tier=${inviterTier})`,
        );
        continue;
      }
      const reservedReward = Math.min(reward, tierCap - earned);
      // Defensive: the legacy `REFERRAL_LIFETIME_CAP_COINS` constant remains
      // in the shared contract for backward-compat with mobile/admin mirrors,
      // but the AUTHORITATIVE cap on the API is `tierCap`. Reference the
      // legacy constant in the log only when it would matter for diagnostics.
      void REFERRAL_LIFETIME_CAP_COINS;
      const refId = tierRefId(tier, purchaserId, purchaseLedgerId);

      try {
        await this.walletService.credit(inviterId, reservedReward, 'referral', refId);
      } catch (err) {
        this.logger.error(
          `Failed to credit T${tier} referral reward ${reservedReward}c to ${inviterId} ` +
            `for purchase ${purchaseLedgerId}: ${(err as Error).message}`,
        );
        continue;
      }

      // Denormalised counter advance — `findOneAndUpdate` is atomic so two
      // concurrent sweepers cannot inflate it past the cap.
      await this.linkModel
        .updateOne(
          { userId: edge.inviterId },
          { $inc: { totalEarnedCoins: reservedReward } },
          { upsert: true },
        )
        .exec();

      credited.push({ tier, inviterId, coins: reservedReward });
    }

    // First-purchase gate flip — the very first time `creditPurchaseRewards`
    // lands for this invitee, mark the canonical T1 row `hasMadeFirstPurchase:
    // true` so the NEXT purchase actually pays the T1 inviter. The flip is
    // guarded on the still-false state so concurrent sweepers race-safely
    // converge on one flip (the loser's `modifiedCount === 0`).
    if (t1Edge && !t1AlreadyFlipped) {
      await this.edgeModel
        .updateOne(
          { inviterId: t1Edge.inviterId, inviteeId: _id, tier: 1, hasMadeFirstPurchase: false },
          { $set: { hasMadeFirstPurchase: true } },
        )
        .exec();
    }

    return { credited };
  }

  // ─────────────────────────── Stats / list ───────────────────────────

  /** Compute the `/referrals/me` per-tier aggregates from the edges collection. */
  private async computeStats(
    userId: string,
    totalEarnedCoinsLifetime: number,
  ): Promise<ReferralStats> {
    const _id = new Types.ObjectId(userId);
    // counts via $count by tier — single aggregate, three buckets
    const counts = await this.edgeModel
      .aggregate<{ _id: ReferralTier; count: number }>([
        { $match: { inviterId: _id } },
        { $group: { _id: '$tier', count: { $sum: 1 } } },
      ])
      .exec();
    const countsByTier: Record<ReferralTier, number> = { 1: 0, 2: 0, 3: 0 };
    for (const row of counts) {
      countsByTier[row._id] = row.count;
    }

    // Per-tier earnings — sum of all wallet credits we ever made to this user
    // under type 'referral' with a tier-prefixed refId. Cheap aggregation; index
    // covered by (userId, _id) on cointransactions.
    const perTier = await this.coinTxModel
      .aggregate<{ _id: ReferralTier; sum: number }>([
        {
          $match: {
            userId: _id,
            type: 'referral',
            refId: { $regex: '^referral-reward:T[123]:' },
          },
        },
        {
          $project: {
            // refId shape: `referral-reward:T{tier}:{purchaser}:{ledger}`
            tier: { $toInt: { $substrBytes: ['$refId', 17, 1] } },
            delta: 1,
          },
        },
        { $group: { _id: '$tier', sum: { $sum: '$delta' } } },
      ])
      .exec();
    const earnedByTier: Record<ReferralTier, number> = { 1: 0, 2: 0, 3: 0 };
    for (const row of perTier) {
      if (row._id === 1 || row._id === 2 || row._id === 3) {
        earnedByTier[row._id] = row.sum;
      }
    }

    return {
      tier1: { count: countsByTier[1], earnedCoins: earnedByTier[1] },
      tier2: { count: countsByTier[2], earnedCoins: earnedByTier[2] },
      tier3: { count: countsByTier[3], earnedCoins: earnedByTier[3] },
      // Source of truth is the denormalised counter (capped by the sweeper).
      totalEarned: totalEarnedCoinsLifetime,
    };
  }

  /**
   * Cursor-paginated downline list, scoped to one `tier`. Resolves the
   * minimal public profile (nickname + avatar) AND the first-purchase flag
   * from the canonical T1 row for each invitee.
   */
  async listDownline(
    userId: string,
    tier: ReferralTier,
    cursor: string | null,
    limit: number,
  ): Promise<{ items: ReferralDownlineEntry[]; meta: PaginationMeta }> {
    const _id = new Types.ObjectId(userId);
    const filter: Record<string, unknown> = { inviterId: _id, tier };
    if (cursor) {
      if (!Types.ObjectId.isValid(cursor)) {
        throw new BadRequestException('Invalid cursor');
      }
      filter._id = { $lt: new Types.ObjectId(cursor) };
    }
    const pageSize = Math.max(1, Math.min(100, limit));
    const rows = await this.edgeModel
      .find(filter)
      .sort({ _id: -1 })
      .limit(pageSize + 1)
      .lean()
      .exec();
    const hasMore = rows.length > pageSize;
    const slice = hasMore ? rows.slice(0, pageSize) : rows;
    const nextCursor = hasMore ? slice[slice.length - 1]!._id.toString() : null;

    if (slice.length === 0) {
      return { items: [], meta: { nextCursor, hasMore: false } };
    }

    const inviteeIds = slice.map((r) => r.inviteeId);

    // Hydrate the invitees' public profile fields (nickname + avatarUrl) and the
    // canonical T1 row (for the first-purchase flag) in two indexed batch reads.
    const [profiles, t1Edges] = await Promise.all([
      this.profileModel
        .find({ userId: { $in: inviteeIds } })
        .select('userId nickname avatarUrl')
        .lean()
        .exec(),
      this.edgeModel
        .find({ inviteeId: { $in: inviteeIds }, tier: 1 })
        .select('inviteeId hasMadeFirstPurchase')
        .lean()
        .exec(),
    ]);

    const profileById = new Map<string, { nickname: string; avatarUrl: string | null }>();
    for (const p of profiles) {
      profileById.set(p.userId.toString(), {
        nickname: p.nickname,
        avatarUrl: p.avatarUrl ?? null,
      });
    }
    const flagByInvitee = new Map<string, boolean>();
    for (const e of t1Edges) {
      flagByInvitee.set(e.inviteeId.toString(), e.hasMadeFirstPurchase);
    }

    const items: ReferralDownlineEntry[] = slice.map((row) => {
      const inviteeIdStr = row.inviteeId.toString();
      const profile = profileById.get(inviteeIdStr);
      const createdAt = (row as { createdAt?: Date }).createdAt;
      return {
        invitee: {
          id: inviteeIdStr,
          nickname: profile?.nickname ?? '',
          avatarUrl: profile?.avatarUrl ?? null,
        },
        signedUpAt: (createdAt ?? new Date(0)).toISOString(),
        hasMadeFirstPurchase: flagByInvitee.get(inviteeIdStr) ?? false,
      };
    });

    return { items, meta: { nextCursor, hasMore } };
  }

  // ─────────────────────────── Helpers ───────────────────────────

  /** UPPER-CASE, length-checked. Returns `null` if the input can't possibly match. */
  private normalizeCode(code: string): string | null {
    if (!code) return null;
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== REFERRAL_CODE_LENGTH) return null;
    if (!/^[A-Z0-9]+$/.test(trimmed)) return null;
    return trimmed;
  }

  /**
   * Generate a fresh `REFERRAL_CODE_LENGTH`-char code from the unambiguous
   * alphabet (no `0/O/1/I/L`). 32-symbol alphabet × 8 chars ≈ 2^40 of entropy —
   * more than enough that the bounded-retry collision path is effectively dead.
   */
  private generateCode(): string {
    const bytes = randomBytes(REFERRAL_CODE_LENGTH);
    let out = '';
    for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) {
      out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
    }
    return out;
  }

  /** True for a MongoDB E11000 (matches the wallet helper). */
  private isDuplicateKeyError(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const code = (err as { code?: number | string }).code;
    return code === DUPLICATE_KEY_CODE;
  }
}
