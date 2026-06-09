import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';

import type { AdminTransaction, EconomyOverview, Rarity } from '@ruletka/shared-types';

import { AuditService } from '../admin/audit.service';

/**
 * A raw aggregation pipeline as the NATIVE MongoDB driver consumes it (plain
 * stage objects via `connection.collection(name).aggregate`), mirroring
 * {@link LeaderboardService}.
 */
type AggregationPipeline = Record<string, unknown>[];

const DAY_MS = 24 * 60 * 60 * 1000;
/** How many recent ledger rows the overview surfaces. */
const RECENT_TX_LIMIT = 10;

/** Gift rarities (kept in sync with `gift.schema.ts` / `raritySchema`). */
const GIFT_RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];
/** `code` shape shared by coin packages + gifts (slug-ish public identifier). */
const CODE_RE = /^[a-z0-9][a-z0-9_-]{1,48}$/i;
/** How many newest *expired* top placements the Top tab keeps for context. */
const TOP_HISTORY_LIMIT = 50;
/** Max number of marketing perks a premium plan may carry. */
const PREMIUM_PERK_MAX = 20;
/** Max length (chars) of a single premium-plan perk line. */
const PREMIUM_PERK_LEN = 120;

/** A `cointransactions` row as read for the recent-activity feed. */
interface CoinTxRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: string;
  delta: number;
  createdAt: Date;
}

/**
 * One `coinpackages` catalogue row as surfaced to the admin console — the shared
 * {@link CoinPackageContract} fields plus the Mongo `id`/timestamps (which the
 * payments-facing contract omits, but the admin table wants).
 */
export interface AdminCoinPackageRow {
  id: string;
  code: string;
  coins: number;
  priceRub: number;
  bonusCoins: number;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Create body for a coin package (all required; `code` must be unique). */
export interface CreateCoinPackageDto {
  code: string;
  coins: number;
  priceRub: number;
  bonusCoins?: number;
}

/**
 * Partial update for a coin package. `code` is intentionally NOT updatable: it
 * is the stable public identifier the payments/checkout flow resolves a package
 * by, so re-keying it out from under an in-flight checkout is unsafe.
 */
export interface UpdateCoinPackageDto {
  coins?: number;
  priceRub?: number;
  bonusCoins?: number;
}

/** One `gifts` catalogue row as surfaced to the admin console. */
export interface AdminGiftRow {
  id: string;
  code: string;
  title: string;
  animationUrl: string;
  priceCoins: number;
  rarity: Rarity;
  isPremiumOnly: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Create body for a gift (`code` must be unique; `rarity` defaults `common`). */
export interface CreateGiftDto {
  code: string;
  title: string;
  animationUrl: string;
  priceCoins: number;
  rarity?: Rarity;
  isPremiumOnly?: boolean;
}

/** Partial update for a gift. `code` is immutable (stable public identifier). */
export interface UpdateGiftDto {
  title?: string;
  animationUrl?: string;
  priceCoins?: number;
  rarity?: Rarity;
  isPremiumOnly?: boolean;
}

/**
 * One `premiumplans` catalogue row as surfaced to the admin console — the shared
 * {@link PremiumPlanContract} fields plus the Mongo `id`/timestamps (which the
 * pricing-facing contract omits, but the admin table wants).
 */
export interface AdminPremiumPlanRow {
  id: string;
  code: string;
  title: string;
  priceRub: number;
  intervalDays: number;
  perks: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

/** Create body for a premium plan (all required; `code` must be unique). */
export interface CreatePremiumPlanDto {
  code: string;
  title: string;
  priceRub: number;
  intervalDays: number;
  perks?: string[];
}

/**
 * Partial update for a premium plan. `code` is intentionally NOT updatable: it
 * is the stable public identifier `Subscription.plan` and the subscribe flow
 * resolve a plan by, so re-keying it out from under an in-flight subscription is
 * unsafe (mirrors {@link UpdateCoinPackageDto}).
 */
export interface UpdatePremiumPlanDto {
  title?: string;
  priceRub?: number;
  intervalDays?: number;
  perks?: string[];
}

/** One `topplacements` row, joined to the promoted account, for the Top tab. */
export interface AdminTopPlacementRow {
  id: string;
  userId: string;
  /** Promoted account's display nickname (joined from `profiles`); '' if none. */
  nickname: string;
  /** Promoted account's avatar URL (joined from `profiles`), if any. */
  avatarUrl: string | null;
  lane: string;
  priority: number;
  coinsSpent: number;
  startsAt: string;
  expiresAt: string;
  /** `true` while `now ∈ [startsAt, expiresAt)`. */
  active: boolean;
}

/**
 * Read-only economy + population snapshot for the admin dashboard, built ON READ
 * from existing collections with a handful of cheap aggregations — no new
 * tracking. Collections are read by NAME via the shared {@link Connection} (same
 * approach {@link LeaderboardService} uses), so this service depends on no
 * economy/users module.
 *
 * Sources:
 *  - population counts → `users` (`totalUsers`, `bannedUsers`, `verifiedUsers`,
 *    `newUsers24h`/`7d`) and `profiles` (`premiumUsers`, the denormalised
 *    `isPremium` flag that login/leaderboard also read);
 *  - `coinsInCirculation` → Σ `wallets.balanceCoins`;
 *  - `giftsValueCoins` → Σ `gifttransactions.priceCoins`;
 *  - `activeTopPlacements` → `topplacements` with `now ∈ [startsAt, expiresAt)`;
 *  - `recentTransactions` → newest ~10 `cointransactions` rows.
 *
 * Wave 2 adds CATALOGUE MANAGEMENT (also collection-by-name, no module deps):
 *  - coin packages (`coinpackages`) — full CRUD; `code` is the unique, immutable
 *    public id the payments flow resolves a package by;
 *  - gifts (`gifts`) — full CRUD; `code` immutable. Hard-delete is safe because
 *    `gifttransactions` denormalises `priceCoins` and is read by `giftId` only
 *    for history, so removing a catalogue row never corrupts past sends;
 *  - premium plans (`premiumplans`) — full CRUD; `code` immutable (the subscribe
 *    flow + `Subscription.plan` resolve a tier by it). These are the SAME
 *    documents `PremiumService` seeds and the public pricing page reads, so
 *    edits here are live; existing subscriptions keep their stored `plan`;
 *  - top placements (`topplacements`) — list (active + recent, joined to the
 *    promoted account) + remove. Placements are CREATED by users buying
 *    visibility, so there is no admin "create" — only takedown.
 */
@Injectable()
export class AdminEconomyService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly auditService: AuditService,
  ) {}

  /** Build the full {@link EconomyOverview}. */
  async getOverview(): Promise<EconomyOverview> {
    const now = new Date();
    const since24h = new Date(now.getTime() - DAY_MS);
    const since7d = new Date(now.getTime() - 7 * DAY_MS);

    const users = this.connection.collection('users');
    const profiles = this.connection.collection('profiles');
    const wallets = this.connection.collection('wallets');
    const gifts = this.connection.collection('gifttransactions');
    const placements = this.connection.collection('topplacements');
    const coinTx = this.connection.collection('cointransactions');

    const [
      totalUsers,
      premiumUsers,
      bannedUsers,
      verifiedUsers,
      newUsers24h,
      newUsers7d,
      activeTopPlacements,
      coinsInCirculation,
      giftsValueCoins,
      recentTransactions,
    ] = await Promise.all([
      users.countDocuments({}),
      // Premium is the denormalised `profiles.isPremium` flag (same source the
      // auth /me + leaderboard reads use for premium).
      profiles.countDocuments({ isPremium: true }),
      users.countDocuments({ isBanned: true }),
      users.countDocuments({ emailVerified: true }),
      users.countDocuments({ createdAt: { $gte: since24h } }),
      users.countDocuments({ createdAt: { $gte: since7d } }),
      placements.countDocuments({
        startsAt: { $lte: now },
        expiresAt: { $gt: now },
      }),
      this.sum(wallets, 'balanceCoins'),
      this.sum(gifts, 'priceCoins'),
      this.recentTransactions(coinTx),
    ]);

    return {
      totalUsers,
      premiumUsers,
      bannedUsers,
      verifiedUsers,
      coinsInCirculation,
      giftsValueCoins,
      activeTopPlacements,
      newUsers24h,
      newUsers7d,
      recentTransactions,
    };
  }

  /** Σ of a numeric field across a whole collection (0 when empty). */
  private async sum(
    collection: ReturnType<Connection['collection']>,
    field: string,
  ): Promise<number> {
    const pipeline: AggregationPipeline = [{ $group: { _id: null, total: { $sum: `$${field}` } } }];
    const rows = await collection.aggregate<{ total: number }>(pipeline).toArray();
    return rows[0]?.total ?? 0;
  }

  /** Newest {@link RECENT_TX_LIMIT} coin-ledger rows, mapped to the contract. */
  private async recentTransactions(
    collection: ReturnType<Connection['collection']>,
  ): Promise<AdminTransaction[]> {
    const rows = (await collection
      .find({}, { projection: { userId: 1, type: 1, delta: 1, createdAt: 1 } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(RECENT_TX_LIMIT)
      .toArray()) as unknown as CoinTxRow[];

    return rows.map((r) => ({
      id: r._id.toString(),
      userId: r.userId.toString(),
      kind: r.type,
      amountCoins: r.delta,
      createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
    }));
  }

  // ════════════════════════════════════════════════════════════════════════
  // Coin packages (`coinpackages`) — full CRUD.
  // ════════════════════════════════════════════════════════════════════════

  /** List the full coin-package catalogue (cheapest first). */
  async listCoinPackages(): Promise<AdminCoinPackageRow[]> {
    const rows = await this.connection
      .collection('coinpackages')
      .find({})
      .sort({ priceRub: 1 })
      .toArray();
    return rows.map((r) => this.toCoinPackageRow(r));
  }

  /** Create a coin package. 409 on duplicate `code`. */
  async createCoinPackage(
    dto: CreateCoinPackageDto,
    callerId?: string | null,
  ): Promise<AdminCoinPackageRow> {
    const code = this.requireCode(dto.code);
    const coins = this.requireInt(dto.coins, 'coins', 1);
    const priceRub = this.requireInt(dto.priceRub, 'priceRub', 1);
    const bonusCoins =
      dto.bonusCoins === undefined ? 0 : this.requireInt(dto.bonusCoins, 'bonusCoins', 0);

    const coll = this.connection.collection('coinpackages');
    if (await coll.findOne({ code })) {
      throw new ConflictException(`Coin package with code "${code}" already exists`);
    }
    const now = new Date();
    const doc = { code, coins, priceRub, bonusCoins, createdAt: now, updatedAt: now };
    const { insertedId } = await coll.insertOne(doc);
    const row = this.toCoinPackageRow({ _id: insertedId, ...doc });
    await this.auditService.log({
      actorId: callerId ?? null,
      action: 'economy.coin_package.create',
      targetType: 'coin_package',
      targetId: row.id,
      meta: { code, coins, priceRub, bonusCoins },
    });
    return row;
  }

  /** Patch a coin package (price/coins/bonus). `code` is immutable. 404 if absent. */
  async updateCoinPackage(
    id: string,
    dto: UpdateCoinPackageDto,
    callerId?: string | null,
  ): Promise<AdminCoinPackageRow> {
    const _id = this.requireObjectId(id, 'Coin package not found');
    const set: Record<string, number | Date> = {};
    if (dto.coins !== undefined) set.coins = this.requireInt(dto.coins, 'coins', 1);
    if (dto.priceRub !== undefined) set.priceRub = this.requireInt(dto.priceRub, 'priceRub', 1);
    if (dto.bonusCoins !== undefined)
      set.bonusCoins = this.requireInt(dto.bonusCoins, 'bonusCoins', 0);
    if (Object.keys(set).length === 0) {
      throw new BadRequestException('No updatable fields provided');
    }
    set.updatedAt = new Date();

    const coll = this.connection.collection('coinpackages');
    const updated = await coll.findOneAndUpdate(
      { _id },
      { $set: set },
      { returnDocument: 'after' },
    );
    const doc = this.unwrapFindAndModify(updated);
    if (!doc) throw new NotFoundException('Coin package not found');
    const row = this.toCoinPackageRow(doc);
    await this.auditService.log({
      actorId: callerId ?? null,
      action: 'economy.coin_package.update',
      targetType: 'coin_package',
      targetId: row.id,
      meta: { code: row.code, coins: row.coins, priceRub: row.priceRub, bonusCoins: row.bonusCoins },
    });
    return row;
  }

  /** Delete a coin package by id. 404 if absent. */
  async deleteCoinPackage(id: string, callerId?: string | null): Promise<{ id: string }> {
    const _id = this.requireObjectId(id, 'Coin package not found');
    const { deletedCount } = await this.connection.collection('coinpackages').deleteOne({ _id });
    if (!deletedCount) throw new NotFoundException('Coin package not found');
    await this.auditService.log({
      actorId: callerId ?? null,
      action: 'economy.coin_package.delete',
      targetType: 'coin_package',
      targetId: id,
    });
    return { id };
  }

  // ════════════════════════════════════════════════════════════════════════
  // Gifts (`gifts`) — full CRUD.
  // ════════════════════════════════════════════════════════════════════════

  /** List the full gift catalogue (cheapest first). */
  async listGifts(): Promise<AdminGiftRow[]> {
    const rows = await this.connection
      .collection('gifts')
      .find({})
      .sort({ priceCoins: 1 })
      .toArray();
    return rows.map((r) => this.toGiftRow(r));
  }

  /** Create a gift. 409 on duplicate `code`. */
  async createGift(dto: CreateGiftDto, callerId?: string | null): Promise<AdminGiftRow> {
    const code = this.requireCode(dto.code);
    const title = this.requireString(dto.title, 'title', 64);
    const animationUrl = this.requireString(dto.animationUrl, 'animationUrl', 512);
    const priceCoins = this.requireInt(dto.priceCoins, 'priceCoins', 0);
    const rarity = this.requireRarity(dto.rarity ?? 'common');
    const isPremiumOnly = this.requireBool(dto.isPremiumOnly ?? false, 'isPremiumOnly');

    const coll = this.connection.collection('gifts');
    if (await coll.findOne({ code })) {
      throw new ConflictException(`Gift with code "${code}" already exists`);
    }
    const now = new Date();
    const doc = {
      code,
      title,
      animationUrl,
      priceCoins,
      rarity,
      isPremiumOnly,
      createdAt: now,
      updatedAt: now,
    };
    const { insertedId } = await coll.insertOne(doc);
    const row = this.toGiftRow({ _id: insertedId, ...doc });
    await this.auditService.log({
      actorId: callerId ?? null,
      action: 'economy.gift.create',
      targetType: 'gift',
      targetId: row.id,
      meta: { code, title, priceCoins, rarity, isPremiumOnly },
    });
    return row;
  }

  /** Patch a gift. `code` is immutable. 404 if absent. */
  async updateGift(
    id: string,
    dto: UpdateGiftDto,
    callerId?: string | null,
  ): Promise<AdminGiftRow> {
    const _id = this.requireObjectId(id, 'Gift not found');
    const set: Record<string, string | number | boolean | Date> = {};
    if (dto.title !== undefined) set.title = this.requireString(dto.title, 'title', 64);
    if (dto.animationUrl !== undefined)
      set.animationUrl = this.requireString(dto.animationUrl, 'animationUrl', 512);
    if (dto.priceCoins !== undefined)
      set.priceCoins = this.requireInt(dto.priceCoins, 'priceCoins', 0);
    if (dto.rarity !== undefined) set.rarity = this.requireRarity(dto.rarity);
    if (dto.isPremiumOnly !== undefined)
      set.isPremiumOnly = this.requireBool(dto.isPremiumOnly, 'isPremiumOnly');
    if (Object.keys(set).length === 0) {
      throw new BadRequestException('No updatable fields provided');
    }
    set.updatedAt = new Date();

    const updated = await this.connection
      .collection('gifts')
      .findOneAndUpdate({ _id }, { $set: set }, { returnDocument: 'after' });
    const doc = this.unwrapFindAndModify(updated);
    if (!doc) throw new NotFoundException('Gift not found');
    const row = this.toGiftRow(doc);
    await this.auditService.log({
      actorId: callerId ?? null,
      action: 'economy.gift.update',
      targetType: 'gift',
      targetId: row.id,
      meta: {
        code: row.code,
        title: row.title,
        priceCoins: row.priceCoins,
        rarity: row.rarity,
        isPremiumOnly: row.isPremiumOnly,
      },
    });
    return row;
  }

  /**
   * Delete a gift by id. 404 if absent. Safe: `gifttransactions` denormalises
   * `priceCoins` and references `giftId` only for the received-gifts history, so
   * removing a catalogue row never breaks a past send.
   */
  async deleteGift(id: string, callerId?: string | null): Promise<{ id: string }> {
    const _id = this.requireObjectId(id, 'Gift not found');
    const { deletedCount } = await this.connection.collection('gifts').deleteOne({ _id });
    if (!deletedCount) throw new NotFoundException('Gift not found');
    await this.auditService.log({
      actorId: callerId ?? null,
      action: 'economy.gift.delete',
      targetType: 'gift',
      targetId: id,
    });
    return { id };
  }

  // ════════════════════════════════════════════════════════════════════════
  // Premium plans (`premiumplans`) — full CRUD.
  //
  // Mirrors the coin-package catalogue: `code` is the unique, immutable public
  // id the subscribe flow resolves a plan by (and `Subscription.plan` stores).
  // The `premiumplans` collection is seeded on boot by `PremiumService`, which
  // ALSO reads it by name; admin edits here land on the same documents, so the
  // pricing page (`GET /premium/plans`) and the subscribe flow see them live.
  // ════════════════════════════════════════════════════════════════════════

  /** List the full premium-plan catalogue (cheapest first). */
  async listPremiumPlans(): Promise<AdminPremiumPlanRow[]> {
    const rows = await this.connection
      .collection('premiumplans')
      .find({})
      .sort({ priceRub: 1 })
      .toArray();
    return rows.map((r) => this.toPremiumPlanRow(r));
  }

  /** Create a premium plan. 409 on duplicate `code`. */
  async createPremiumPlan(
    dto: CreatePremiumPlanDto,
    callerId?: string | null,
  ): Promise<AdminPremiumPlanRow> {
    const code = this.requireCode(dto.code);
    const title = this.requireString(dto.title, 'title', 64);
    const priceRub = this.requireInt(dto.priceRub, 'priceRub', 1);
    const intervalDays = this.requireInt(dto.intervalDays, 'intervalDays', 1);
    const perks = this.requirePerks(dto.perks ?? []);

    const coll = this.connection.collection('premiumplans');
    if (await coll.findOne({ code })) {
      throw new ConflictException(`Premium plan with code "${code}" already exists`);
    }
    const now = new Date();
    const doc = { code, title, priceRub, intervalDays, perks, createdAt: now, updatedAt: now };
    const { insertedId } = await coll.insertOne(doc);
    const row = this.toPremiumPlanRow({ _id: insertedId, ...doc });
    await this.auditService.log({
      actorId: callerId ?? null,
      action: 'economy.premium_plan.create',
      targetType: 'premium_plan',
      targetId: row.id,
      meta: { code, title, priceRub, intervalDays },
    });
    return row;
  }

  /**
   * Patch a premium plan (title/price/interval/perks). `code` is immutable (the
   * stable public id the subscribe flow resolves a plan by). 404 if absent.
   */
  async updatePremiumPlan(
    id: string,
    dto: UpdatePremiumPlanDto,
    callerId?: string | null,
  ): Promise<AdminPremiumPlanRow> {
    const _id = this.requireObjectId(id, 'Premium plan not found');
    const set: Record<string, string | number | string[] | Date> = {};
    if (dto.title !== undefined) set.title = this.requireString(dto.title, 'title', 64);
    if (dto.priceRub !== undefined) set.priceRub = this.requireInt(dto.priceRub, 'priceRub', 1);
    if (dto.intervalDays !== undefined)
      set.intervalDays = this.requireInt(dto.intervalDays, 'intervalDays', 1);
    if (dto.perks !== undefined) set.perks = this.requirePerks(dto.perks);
    if (Object.keys(set).length === 0) {
      throw new BadRequestException('No updatable fields provided');
    }
    set.updatedAt = new Date();

    const updated = await this.connection
      .collection('premiumplans')
      .findOneAndUpdate({ _id }, { $set: set }, { returnDocument: 'after' });
    const doc = this.unwrapFindAndModify(updated);
    if (!doc) throw new NotFoundException('Premium plan not found');
    const row = this.toPremiumPlanRow(doc);
    await this.auditService.log({
      actorId: callerId ?? null,
      action: 'economy.premium_plan.update',
      targetType: 'premium_plan',
      targetId: row.id,
      meta: {
        code: row.code,
        title: row.title,
        priceRub: row.priceRub,
        intervalDays: row.intervalDays,
      },
    });
    return row;
  }

  /**
   * Delete a premium plan by id. 404 if absent. Existing subscriptions keep
   * their denormalised `plan` code and entitlement window, so removing a
   * catalogue row only pulls the tier from the pricing page going forward.
   */
  async deletePremiumPlan(id: string, callerId?: string | null): Promise<{ id: string }> {
    const _id = this.requireObjectId(id, 'Premium plan not found');
    const { deletedCount } = await this.connection.collection('premiumplans').deleteOne({ _id });
    if (!deletedCount) throw new NotFoundException('Premium plan not found');
    await this.auditService.log({
      actorId: callerId ?? null,
      action: 'economy.premium_plan.delete',
      targetType: 'premium_plan',
      targetId: id,
    });
    return { id };
  }

  // ════════════════════════════════════════════════════════════════════════
  // Top placements (`topplacements`) — list (joined) + remove.
  // ════════════════════════════════════════════════════════════════════════

  /**
   * List placements for the Top tab: every currently-active placement (highest
   * priority first), then the newest expired ones for context — each joined to
   * the promoted account's nickname/avatar via ONE `$in` over `profiles`.
   */
  async listTopPlacements(): Promise<AdminTopPlacementRow[]> {
    const now = new Date();
    const coll = this.connection.collection('topplacements');

    const [active, expired] = await Promise.all([
      coll
        .find({ startsAt: { $lte: now }, expiresAt: { $gt: now } })
        .sort({ priority: -1, expiresAt: 1 })
        .toArray(),
      coll
        .find({ expiresAt: { $lte: now } })
        .sort({ expiresAt: -1 })
        .limit(TOP_HISTORY_LIMIT)
        .toArray(),
    ]);

    const rows = [...active, ...expired];
    const profiles = await this.loadProfiles(
      rows.map((r) => r.userId as Types.ObjectId).filter(Boolean),
    );

    return rows.map((r) => {
      const uid = (r.userId as Types.ObjectId | undefined)?.toString() ?? '';
      const profile = profiles.get(uid);
      const expiresAt = this.asDate(r.expiresAt);
      const startsAt = this.asDate(r.startsAt);
      return {
        id: (r._id as Types.ObjectId).toString(),
        userId: uid,
        nickname: profile?.nickname ?? '',
        avatarUrl: profile?.avatarUrl ?? null,
        lane: typeof r.lane === 'string' ? r.lane : '',
        priority: typeof r.priority === 'number' ? r.priority : 0,
        coinsSpent: typeof r.coinsSpent === 'number' ? r.coinsSpent : 0,
        startsAt: startsAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        active: startsAt <= now && expiresAt > now,
      };
    });
  }

  /** Remove (take down) one top placement by id. 404 if absent. */
  async removeTopPlacement(id: string, callerId?: string | null): Promise<{ id: string }> {
    const _id = this.requireObjectId(id, 'Placement not found');
    const coll = this.connection.collection('topplacements');
    // Read the placement BEFORE the delete so the audit trail records WHOSE paid
    // placement was taken down (the row's userId + coinsSpent are gone afterward).
    const placement = (await coll.findOne(
      { _id },
      { projection: { userId: 1, coinsSpent: 1 } },
    )) as { userId?: Types.ObjectId; coinsSpent?: number } | null;
    const { deletedCount } = await coll.deleteOne({ _id });
    if (!deletedCount) throw new NotFoundException('Placement not found');
    await this.auditService.log({
      actorId: callerId ?? null,
      action: 'economy.top.remove',
      targetType: 'top_placement',
      targetId: id,
      meta: {
        userId: placement?.userId ? placement.userId.toString() : null,
        coinsSpent: typeof placement?.coinsSpent === 'number' ? placement.coinsSpent : null,
      },
    });
    return { id };
  }

  // ── Projection helpers ────────────────────────────────────────────────────

  /** Project a raw `coinpackages` doc to the admin row shape. */
  private toCoinPackageRow(doc: Record<string, unknown>): AdminCoinPackageRow {
    return {
      id: (doc._id as Types.ObjectId).toString(),
      code: typeof doc.code === 'string' ? doc.code : '',
      coins: typeof doc.coins === 'number' ? doc.coins : 0,
      priceRub: typeof doc.priceRub === 'number' ? doc.priceRub : 0,
      bonusCoins: typeof doc.bonusCoins === 'number' ? doc.bonusCoins : 0,
      createdAt: this.maybeIso(doc.createdAt),
      updatedAt: this.maybeIso(doc.updatedAt),
    };
  }

  /** Project a raw `gifts` doc to the admin row shape. */
  private toGiftRow(doc: Record<string, unknown>): AdminGiftRow {
    const rarity = doc.rarity;
    return {
      id: (doc._id as Types.ObjectId).toString(),
      code: typeof doc.code === 'string' ? doc.code : '',
      title: typeof doc.title === 'string' ? doc.title : '',
      animationUrl: typeof doc.animationUrl === 'string' ? doc.animationUrl : '',
      priceCoins: typeof doc.priceCoins === 'number' ? doc.priceCoins : 0,
      rarity: (GIFT_RARITIES as readonly string[]).includes(rarity as string)
        ? (rarity as Rarity)
        : 'common',
      isPremiumOnly: doc.isPremiumOnly === true,
      createdAt: this.maybeIso(doc.createdAt),
      updatedAt: this.maybeIso(doc.updatedAt),
    };
  }

  /** Project a raw `premiumplans` doc to the admin row shape. */
  private toPremiumPlanRow(doc: Record<string, unknown>): AdminPremiumPlanRow {
    const perks = Array.isArray(doc.perks)
      ? doc.perks.filter((p): p is string => typeof p === 'string')
      : [];
    return {
      id: (doc._id as Types.ObjectId).toString(),
      code: typeof doc.code === 'string' ? doc.code : '',
      title: typeof doc.title === 'string' ? doc.title : '',
      priceRub: typeof doc.priceRub === 'number' ? doc.priceRub : 0,
      intervalDays: typeof doc.intervalDays === 'number' ? doc.intervalDays : 0,
      perks,
      createdAt: this.maybeIso(doc.createdAt),
      updatedAt: this.maybeIso(doc.updatedAt),
    };
  }

  /**
   * Batch-load `userId → {nickname, avatarUrl}` from `profiles` in ONE `$in`
   * query (mirrors {@link AdminService.loadNicknames}). Missing profiles are
   * simply absent from the map.
   */
  private async loadProfiles(
    userIds: Types.ObjectId[],
  ): Promise<Map<string, { nickname: string; avatarUrl: string | null }>> {
    const out = new Map<string, { nickname: string; avatarUrl: string | null }>();
    if (userIds.length === 0) return out;
    const docs = await this.connection
      .collection('profiles')
      .find({ userId: { $in: userIds } }, { projection: { userId: 1, nickname: 1, avatarUrl: 1 } })
      .toArray();
    for (const doc of docs) {
      const p = doc as unknown as {
        userId: Types.ObjectId;
        nickname?: string;
        avatarUrl?: string | null;
      };
      out.set(p.userId.toString(), {
        nickname: p.nickname ?? '',
        avatarUrl: p.avatarUrl ?? null,
      });
    }
    return out;
  }

  // ── Validation + coercion helpers ─────────────────────────────────────────

  /** Trim + validate a public `code` (slug-ish, 2..49 chars). */
  private requireCode(raw: unknown): string {
    const code = typeof raw === 'string' ? raw.trim() : '';
    if (!CODE_RE.test(code)) {
      throw new BadRequestException(
        'code must be 2–49 chars: letters, digits, "_" or "-" (first char alphanumeric)',
      );
    }
    return code;
  }

  /** Require a finite integer ≥ `min`. */
  private requireInt(raw: unknown, field: string, min: number): number {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw) || raw < min) {
      throw new BadRequestException(`${field} must be an integer ≥ ${min}`);
    }
    return raw;
  }

  /** Require a non-empty trimmed string no longer than `max`. */
  private requireString(raw: unknown, field: string, max: number): string {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (s.length === 0 || s.length > max) {
      throw new BadRequestException(`${field} must be a non-empty string ≤ ${max} chars`);
    }
    return s;
  }

  /** Require a boolean. */
  private requireBool(raw: unknown, field: string): boolean {
    if (typeof raw !== 'boolean') {
      throw new BadRequestException(`${field} must be a boolean`);
    }
    return raw;
  }

  /** Require one of the known gift rarities. */
  private requireRarity(raw: unknown): Rarity {
    if (!(GIFT_RARITIES as readonly string[]).includes(raw as string)) {
      throw new BadRequestException(`rarity must be one of: ${GIFT_RARITIES.join(', ')}`);
    }
    return raw as Rarity;
  }

  /**
   * Validate a premium-plan `perks` list: an array (≤ {@link PREMIUM_PERK_MAX})
   * of non-empty trimmed strings (each ≤ {@link PREMIUM_PERK_LEN} chars). Blank
   * entries are dropped; the empty list is allowed.
   */
  private requirePerks(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
      throw new BadRequestException('perks must be an array of strings');
    }
    const perks: string[] = [];
    for (const entry of raw) {
      if (typeof entry !== 'string') {
        throw new BadRequestException('perks must be an array of strings');
      }
      const trimmed = entry.trim();
      if (trimmed.length === 0) continue;
      if (trimmed.length > PREMIUM_PERK_LEN) {
        throw new BadRequestException(`each perk must be ≤ ${PREMIUM_PERK_LEN} chars`);
      }
      perks.push(trimmed);
    }
    if (perks.length > PREMIUM_PERK_MAX) {
      throw new BadRequestException(`at most ${PREMIUM_PERK_MAX} perks are allowed`);
    }
    return perks;
  }

  /** Validate a Mongo ObjectId string; throw 404 (resource-shaped) if malformed. */
  private requireObjectId(id: string, notFoundMsg: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(notFoundMsg);
    }
    return new Types.ObjectId(id);
  }

  /** Coerce a possibly-Date / possibly-string value to a `Date` (epoch on miss). */
  private asDate(raw: unknown): Date {
    if (raw instanceof Date) return raw;
    if (typeof raw === 'string' || typeof raw === 'number') {
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return new Date(0);
  }

  /** ISO string for a Date-ish value, or `null` when absent/unparseable. */
  private maybeIso(raw: unknown): string | null {
    if (raw == null) return null;
    if (raw instanceof Date) return raw.toISOString();
    if (typeof raw === 'string' || typeof raw === 'number') {
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    return null;
  }

  /**
   * Normalise the driver's `findOneAndUpdate` return across driver versions:
   * some return the document directly, older typings wrap it in `{ value }`.
   */
  private unwrapFindAndModify(result: unknown): Record<string, unknown> | null {
    if (result && typeof result === 'object' && 'value' in result) {
      return (result as { value: Record<string, unknown> | null }).value;
    }
    return (result as Record<string, unknown> | null) ?? null;
  }
}
