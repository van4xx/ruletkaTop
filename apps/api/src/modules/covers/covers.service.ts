import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import type {
  CoverId,
  CoverInventory,
  FrameDesign,
  FrameId,
  ProfileCover,
  PublicProfile,
  UserFrame,
} from '@ruletka/shared-types';
import {
  COVER_CATALOGUE,
  DEFAULT_COVER_ID,
  FRAME_CATALOGUE,
  FREE_COVER_IDS,
  FREE_FRAME_IDS,
  PRO_ONLY_COVER_IDS,
} from '@ruletka/shared-types';

import { PremiumService } from '../premium/premium.service';
import { Profile, ProfileDocument } from '../profiles/schemas/profile.schema';
import { ProfilesService } from '../profiles/profiles.service';
import { WalletService } from '../wallet/wallet.service';

/** Pro-only cover ids as a Set for O(1) lookup on the equip path. */
const PRO_ONLY_COVER_SET = new Set<CoverId>(PRO_ONLY_COVER_IDS);

/** Fast catalogue lookup by id (the catalogue is code-defined + immutable). */
const COVER_BY_ID = new Map<CoverId, ProfileCover>(COVER_CATALOGUE.map((c) => [c.id, c]));

/** The free cover ids as a Set for O(1) ownership membership tests. */
const FREE_SET = new Set<CoverId>(FREE_COVER_IDS);

/** Fast frame catalogue lookup by id (mirrors `COVER_BY_ID`). */
const FRAME_BY_ID = new Map<FrameId, FrameDesign>(FRAME_CATALOGUE.map((f) => [f.id, f]));

/** The free frame ids as a Set for O(1) ownership membership tests. */
const FREE_FRAME_SET = new Set<FrameId>(FREE_FRAME_IDS);

/**
 * Profile-cover cosmetics: the code-defined catalogue read model plus the
 * owned-inventory and coin-spend purchase flow — mirroring {@link GiftsService}
 * / `TopService` end-to-end.
 *
 * Buying a cover atomically DEBITS the buyer's wallet (via the exported
 * {@link WalletService}, ledger type `cover`, with the cover id as the `refId`)
 * and appends the id to the buyer's private `ownedCovers` (auto-activating it).
 * The two FREE covers are implicitly owned and never stored. Every mutation only
 * ever touches the CALLER's own profile (never a target user id), and a write
 * failure after a successful debit issues a compensating `refund` credit so we
 * never charge without recording ownership.
 */
@Injectable()
export class CoversService {
  private readonly logger = new Logger(CoversService.name);

  constructor(
    @InjectModel(Profile.name) private readonly profileModel: Model<ProfileDocument>,
    private readonly walletService: WalletService,
    private readonly profilesService: ProfilesService,
    private readonly premiumService: PremiumService,
  ) {}

  /** The full cover catalogue (cheapest-first: free covers, then the price ladder). */
  findAll(): ProfileCover[] {
    return [...COVER_CATALOGUE];
  }

  /**
   * The caller's cover inventory: the active cover and the full owned set
   * (free ids ∪ purchased ids). `404` if the profile does not exist.
   */
  async getMine(userId: string): Promise<CoverInventory> {
    const doc = await this.requireProfile(userId);
    return this.toInventory(doc);
  }

  /**
   * Purchase `coverId` for the caller (and auto-activate it).
   *
   * Order of operations (auditable + safe, like {@link GiftsService.sendGift}):
   *  1. resolve the cover (`404` if unknown — defence in depth; the DTO already
   *     constrains the id to the enum);
   *  2. reject FREE covers (`409` — already owned, nothing to buy);
   *  3. reject covers the caller ALREADY owns (`409`);
   *  4. atomically DEBIT the buyer (`cover`) — throws `422` on low balance —
   *     using the cover id as the ledger `refId`;
   *  5. `$addToSet` the id into `ownedCovers` AND set it active in one update.
   *     On a write failure after a successful debit, the coins are refunded
   *     (compensating `refund` credit) so a charge always has matching ownership.
   *
   * @returns the updated inventory `{ active, owned }`.
   */
  async purchase(userId: string, coverId: CoverId): Promise<CoverInventory> {
    const cover = COVER_BY_ID.get(coverId);
    if (!cover) {
      throw new NotFoundException('Cover not found');
    }
    if (cover.tier === 'free') {
      throw new ConflictException('This cover is free and already owned');
    }

    const profile = await this.requireProfile(userId);
    if (this.ownsCover(profile, coverId)) {
      throw new ConflictException('Cover already owned');
    }

    // The wallet ledger's idempotency index is GLOBAL on (type, refId), so the
    // refId MUST uniquely identify THIS operation. The bare catalogue `coverId`
    // is a code-defined constant shared by every buyer — using it as the refId
    // collided across users: the second buyer's debit hit the first buyer's
    // ledger row, self-refunded, and the cover was still granted (a paid cover
    // for free).
    //
    // A `${userId}:${coverId}` pair fixes the cross-USER collision, but is still
    // a FIXED key for a given (user, cover): if the grant write fails, the
    // compensating refund fires, and the user RETRIES, the re-debit collides on
    // that same fixed refId → idempotent self-cancelling no-op → the cover is
    // granted at ZERO net cost. Mint a PER-ATTEMPT ref instead (a fresh ObjectId
    // every call) so each retry re-charges for real. The compensating refund
    // below reuses THIS attempt's ref so the debit/refund pair still nets to
    // zero, and a concurrent double-buy is caught upstream by the ownsCover
    // check (the per-attempt ref no longer dedupes that, but ownership does).
    const ledgerRef = `${userId}:${coverId}:${new Types.ObjectId().toString()}`;

    // Step 4: charge first. Throws InsufficientFundsException (422) on shortfall.
    await this.walletService.debit(userId, cover.priceCoins, 'cover', ledgerRef);

    // Step 5: grant ownership + activate; compensate the debit on a write failure.
    try {
      const updated = await this.profileModel
        .findOneAndUpdate(
          { userId: new Types.ObjectId(userId) },
          { $addToSet: { ownedCovers: coverId }, $set: { activeCover: coverId } },
          { new: true },
        )
        .exec();
      if (!updated) {
        throw new NotFoundException('Profile not found');
      }
      return this.toInventory(updated);
    } catch (err) {
      await this.walletService
        .credit(userId, cover.priceCoins, 'refund', ledgerRef)
        .catch((refundErr: unknown) =>
          this.logger.error(
            `Failed to refund ${cover.priceCoins} coins to ${userId} after cover ` +
              `grant write failure: ${(refundErr as Error).message}`,
          ),
        );
      throw err;
    }
  }

  /**
   * Set the caller's active cover to `coverId`. The cover must be free or owned
   * (`403` otherwise — you can't wear a cover you don't own). Returns the updated
   * public profile so the hero can update instantly.
   */
  async setActive(userId: string, coverId: CoverId): Promise<PublicProfile> {
    const cover = COVER_BY_ID.get(coverId);
    if (!cover) {
      throw new NotFoundException('Cover not found');
    }

    const profile = await this.requireProfile(userId);
    if (!this.ownsCover(profile, coverId)) {
      throw new ForbiddenException('You do not own this cover');
    }

    // Pro-only gate: a cover marketed as Pro-only (see PRO_ONLY_COVER_IDS) can
    // only be EQUIPPED by a Pro subscriber. Ownership is still allowed (the
    // user may have bought it on a Pro plan and then downgraded), but the
    // equip is gated separately so a downgrade visibly reverts the look.
    // 403 with a clear `requiredTier` so the client can render the upsell.
    if (PRO_ONLY_COVER_SET.has(coverId)) {
      const isPro = await this.premiumService.hasTierOrAbove(userId, 'pro');
      if (!isPro) {
        throw new ForbiddenException({
          message: 'This cover is Pro-only',
          code: 'PRO_ONLY_COVER',
          requiredTier: 'pro',
          coverId,
        });
      }
    }

    const updated = await this.profileModel
      .findOneAndUpdate(
        { userId: new Types.ObjectId(userId) },
        { $set: { activeCover: coverId } },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException('Profile not found');
    }
    // Reuse the canonical public projection (keeps the cover-set-active response
    // shape identical to GET /profiles/:id, so the client caches it the same).
    return this.profilesService.getPublicProfile(userId);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** Load the caller's profile or throw `404`. */
  private async requireProfile(userId: string): Promise<ProfileDocument> {
    const doc = await this.profilesService.findByUserId(userId);
    if (!doc) {
      throw new NotFoundException('Profile not found');
    }
    return doc;
  }

  /** Whether the caller owns `coverId` (free covers are implicitly owned). */
  private ownsCover(profile: ProfileDocument, coverId: CoverId): boolean {
    return FREE_SET.has(coverId) || (profile.ownedCovers ?? []).includes(coverId);
  }

  /** Build the `{ active, owned }` inventory from a profile document. */
  private toInventory(profile: ProfileDocument): CoverInventory {
    const purchased = (profile.ownedCovers ?? []) as CoverId[];
    // Free ids ∪ purchased ids, deduped, free first then purchase order.
    const owned = [...FREE_COVER_IDS, ...purchased.filter((id) => !FREE_SET.has(id))];
    return {
      active: (profile.activeCover as CoverId | undefined) ?? DEFAULT_COVER_ID,
      owned,
    };
  }

  // ── FRAMES ────────────────────────────────────────────────────────────────
  //
  // Avatar frames mirror the cover storefront end-to-end (atomic wallet debit
  // with per-attempt ledger ref, refund-on-grant-failure, free ids implicitly
  // owned). The only structural difference is that a frame is OPTIONAL —
  // `equipped` is nullable and unequipping is a first-class operation.

  /** The full frame catalogue (cheapest-first: free frames, then the price ladder). */
  findAllFrames(): FrameDesign[] {
    return [...FRAME_CATALOGUE];
  }

  /**
   * The caller's frame inventory: the equipped frame (or `null`) and the
   * full owned set (free ids ∪ purchased ids). `404` if the profile does
   * not exist.
   */
  async getMyFrames(userId: string): Promise<UserFrame> {
    const doc = await this.requireProfile(userId);
    return this.toFrameInventory(doc);
  }

  /**
   * Purchase `frameId` for the caller (and auto-equip it). End-to-end identical
   * to {@link purchase} for covers: per-attempt ledger ref (so a retry actually
   * re-charges), atomic debit FIRST, then `$addToSet` + `$set equippedFrameId`
   * in a single update, and a compensating refund on a post-debit write failure.
   *
   * @returns the updated inventory `{ equipped, owned }`.
   */
  async purchaseFrame(userId: string, frameId: FrameId): Promise<UserFrame> {
    const frame = FRAME_BY_ID.get(frameId);
    if (!frame) {
      throw new NotFoundException('Frame not found');
    }
    if (frame.tier === 'free') {
      throw new ConflictException('This frame is free and already owned');
    }

    const profile = await this.requireProfile(userId);
    if (this.ownsFrame(profile, frameId)) {
      throw new ConflictException('Frame already owned');
    }

    // Per-attempt ref (see covers.purchase for the full rationale). The
    // (user, frame) prefix scopes ownership per buyer; the trailing ObjectId
    // ensures a retry of a failed grant actually re-charges instead of
    // idempotently self-cancelling against the prior attempt's ledger row.
    const ledgerRef = `${userId}:${frameId}:${new Types.ObjectId().toString()}`;

    await this.walletService.debit(userId, frame.priceCoins, 'frame', ledgerRef);

    try {
      const updated = await this.profileModel
        .findOneAndUpdate(
          { userId: new Types.ObjectId(userId) },
          { $addToSet: { ownedFrames: frameId }, $set: { equippedFrameId: frameId } },
          { new: true },
        )
        .exec();
      if (!updated) {
        throw new NotFoundException('Profile not found');
      }
      return this.toFrameInventory(updated);
    } catch (err) {
      await this.walletService
        .credit(userId, frame.priceCoins, 'refund', ledgerRef)
        .catch((refundErr: unknown) =>
          this.logger.error(
            `Failed to refund ${frame.priceCoins} coins to ${userId} after frame ` +
              `grant write failure: ${(refundErr as Error).message}`,
          ),
        );
      throw err;
    }
  }

  /**
   * Equip a frame on the caller's avatar, or pass `null` to unequip (the
   * avatar will render with no frame). The frame must be free or owned
   * (`403` otherwise). Returns the updated public profile so the hero can
   * refresh instantly — matching {@link setActive} for covers.
   */
  async equipFrame(userId: string, frameId: FrameId | null): Promise<PublicProfile> {
    if (frameId !== null) {
      const frame = FRAME_BY_ID.get(frameId);
      if (!frame) {
        throw new NotFoundException('Frame not found');
      }
      const profile = await this.requireProfile(userId);
      if (!this.ownsFrame(profile, frameId)) {
        throw new ForbiddenException('You do not own this frame');
      }
    } else {
      // Profile must still exist when unequipping (mirrors the cover guard).
      await this.requireProfile(userId);
    }

    const updated = await this.profileModel
      .findOneAndUpdate(
        { userId: new Types.ObjectId(userId) },
        { $set: { equippedFrameId: frameId } },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException('Profile not found');
    }
    return this.profilesService.getPublicProfile(userId);
  }

  /** Whether the caller owns `frameId` (free frames are implicitly owned). */
  private ownsFrame(profile: ProfileDocument, frameId: FrameId): boolean {
    return FREE_FRAME_SET.has(frameId) || (profile.ownedFrames ?? []).includes(frameId);
  }

  /** Build the `{ equipped, owned }` frame inventory from a profile document. */
  private toFrameInventory(profile: ProfileDocument): UserFrame {
    const purchased = (profile.ownedFrames ?? []) as FrameId[];
    const owned = [...FREE_FRAME_IDS, ...purchased.filter((id) => !FREE_FRAME_SET.has(id))];
    return {
      equipped: (profile.equippedFrameId as FrameId | null | undefined) ?? null,
      owned,
    };
  }
}
