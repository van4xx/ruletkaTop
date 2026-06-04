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
  ProfileCover,
  PublicProfile,
} from '@ruletka/shared-types';
import { COVER_CATALOGUE, FREE_COVER_IDS } from '@ruletka/shared-types';

import { Profile, ProfileDocument } from '../profiles/schemas/profile.schema';
import { ProfilesService } from '../profiles/profiles.service';
import { WalletService } from '../wallet/wallet.service';

/** Fast catalogue lookup by id (the catalogue is code-defined + immutable). */
const COVER_BY_ID = new Map<CoverId, ProfileCover>(COVER_CATALOGUE.map((c) => [c.id, c]));

/** The free cover ids as a Set for O(1) ownership membership tests. */
const FREE_SET = new Set<CoverId>(FREE_COVER_IDS);

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

    // Step 4: charge first. Throws InsufficientFundsException (422) on shortfall.
    await this.walletService.debit(userId, cover.priceCoins, 'cover', coverId);

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
        .credit(userId, cover.priceCoins, 'refund', coverId)
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
      active: (profile.activeCover as CoverId | undefined) ?? COVER_CATALOGUE[0].id,
      owned,
    };
  }
}
