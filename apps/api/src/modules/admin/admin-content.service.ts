import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';

import type {
  AdminAnnouncement,
  AdminAnnouncementList,
  AdminCover,
  AdminCoverList,
  AdminCreateAnnouncementDto,
} from '@ruletka/shared-types';
import { COVER_CATALOGUE } from '@ruletka/shared-types';

/**
 * Admin content surface.
 *
 * Covers — REAL: the catalogue is the code-defined {@link COVER_CATALOGUE}
 * (covers are render-bound to client presets, so there is no DB collection);
 * the live ownership count per cover is aggregated from the `profiles`
 * collection's `ownedCovers` array (free covers are implicitly owned by
 * everyone, so their count reflects total profiles).
 *
 * Announcements — STUB: there is no announcements collection yet. The list
 * returns empty and create echoes a synthesized record. Wave-2 introduces an
 * `announcements` schema + system-banner delivery. // TODO(wave2)
 */
@Injectable()
export class AdminContentService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /** The cover catalogue with live ownership counts. */
  async listCovers(): Promise<AdminCoverList> {
    const profiles = this.connection.collection('profiles');

    // One grouped aggregation over the unwound `ownedCovers` arrays → id → count.
    const ownedAgg = await profiles
      .aggregate<{ _id: string; count: number }>([
        { $project: { ownedCovers: 1 } },
        { $unwind: { path: '$ownedCovers', preserveNullAndEmptyArrays: false } },
        { $group: { _id: '$ownedCovers', count: { $sum: 1 } } },
      ])
      .toArray();
    const ownedById = new Map(ownedAgg.map((r) => [r._id, r.count]));

    // Free covers are implicitly owned by everyone → report total profiles.
    const totalProfiles = await profiles.estimatedDocumentCount();

    const items: AdminCover[] = COVER_CATALOGUE.map((c) => ({
      id: c.id,
      name: c.name,
      tier: c.tier,
      priceCoins: c.priceCoins,
      accent: c.accent,
      ownedCount: c.tier === 'free' ? totalProfiles : (ownedById.get(c.id) ?? 0),
    }));

    return { items };
  }

  /**
   * STUB — no announcements collection yet. Always empty. // TODO(wave2)
   */
  async listAnnouncements(): Promise<AdminAnnouncementList> {
    // TODO(wave2): read from a real `announcements` collection.
    return { items: [] };
  }

  /**
   * STUB — synthesizes (does NOT persist) an announcement record so the contract
   * + UI flow exist. Wave-2 persists + delivers it. // TODO(wave2)
   */
  async createAnnouncement(dto: AdminCreateAnnouncementDto): Promise<AdminAnnouncement> {
    // TODO(wave2): persist into the `announcements` collection + deliver banner.
    return {
      id: new Types.ObjectId().toString(),
      title: dto.title,
      body: dto.body,
      active: dto.active,
      createdAt: new Date().toISOString(),
    };
  }
}
