import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';

import type {
  AdminAnnouncement,
  AdminAnnouncementList,
  AdminCover,
  AdminCoverList,
  AdminCreateAnnouncementDto,
} from '@ruletka/shared-types';
import { COVER_CATALOGUE } from '@ruletka/shared-types';

import { Announcement, AnnouncementDocument } from './schemas/announcement.schema';

/** Fields an announcement PATCH may change (all optional). */
export interface AnnouncementPatch {
  title?: string;
  body?: string;
  active?: boolean;
}

/**
 * Admin content surface.
 *
 * Covers — REAL: the catalogue is the code-defined {@link COVER_CATALOGUE}
 * (covers are render-bound to client presets, so there is no DB collection);
 * the live ownership count per cover is aggregated from the `profiles`
 * collection's `ownedCovers` array (free covers are implicitly owned by
 * everyone, so their count reflects total profiles).
 *
 * Announcements — REAL (WAVE-2): persisted in the `announcements` collection.
 * Listed newest-first; created/toggled/edited/deleted from the admin panel
 * (create + mutate are admin-only + audited at the controller).
 */
@Injectable()
export class AdminContentService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Announcement.name)
    private readonly announcementModel: Model<AnnouncementDocument>,
  ) {}

  /** The cover catalogue with live ownership counts. */
  async listCovers(): Promise<AdminCoverList> {
    const profiles = this.connection.collection('profiles');

    // One grouped aggregation over the unwound `ownedCovers` arrays → id → count.
    const ownedAgg = await profiles
      .aggregate<{
        _id: string;
        count: number;
      }>([
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

  /** All announcements, newest first. */
  async listAnnouncements(): Promise<AdminAnnouncementList> {
    const rows = await this.announcementModel.find().sort({ _id: -1 }).limit(200).lean().exec();
    return { items: rows.map((r) => this.toAnnouncement(r)) };
  }

  /** Persist a new announcement (admin-only; audited at the controller). */
  async createAnnouncement(
    dto: AdminCreateAnnouncementDto,
    actorId?: string | null,
  ): Promise<AdminAnnouncement> {
    const created = await this.announcementModel.create({
      title: dto.title,
      body: dto.body,
      active: dto.active,
      createdBy: actorId && Types.ObjectId.isValid(actorId) ? new Types.ObjectId(actorId) : null,
    });
    return this.toAnnouncement(created.toObject());
  }

  /**
   * Patch an announcement (toggle active and/or edit title/body). Only the
   * provided fields are changed. Throws 404 if the id is unknown.
   */
  async updateAnnouncement(id: string, patch: AnnouncementPatch): Promise<AdminAnnouncement> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Announcement not found');
    }
    const update: AnnouncementPatch = {};
    if (patch.title !== undefined) update.title = patch.title;
    if (patch.body !== undefined) update.body = patch.body;
    if (patch.active !== undefined) update.active = patch.active;

    const row = await this.announcementModel
      .findByIdAndUpdate(id, { $set: update }, { new: true })
      .lean()
      .exec();
    if (!row) {
      throw new NotFoundException('Announcement not found');
    }
    return this.toAnnouncement(row);
  }

  /** Delete an announcement. Throws 404 if the id is unknown. */
  async deleteAnnouncement(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Announcement not found');
    }
    const res = await this.announcementModel.deleteOne({ _id: new Types.ObjectId(id) }).exec();
    if (res.deletedCount === 0) {
      throw new NotFoundException('Announcement not found');
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** Map a lean announcement document to the shared contract shape. */
  private toAnnouncement(row: {
    _id: Types.ObjectId;
    title: string;
    body: string;
    active: boolean;
    createdAt?: Date;
  }): AdminAnnouncement {
    return {
      id: row._id.toString(),
      title: row.title,
      body: row.body,
      active: row.active,
      createdAt: (row.createdAt ?? new Date()).toISOString(),
    };
  }
}
