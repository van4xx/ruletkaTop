import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import type {
  PrivacySettings,
  Settings as SettingsContract,
  UpdateSettingsDto,
  Visibility,
} from '@ruletka/shared-types';

import { Settings, SettingsDocument } from './schemas/settings.schema';

/**
 * Privacy defaults — MUST mirror the schema/`privacySettingsSchema` defaults.
 * Used as the fallback for a user who has never materialised a settings doc, so
 * a read-only privacy check never has to write one.
 */
const DEFAULT_PRIVACY: PrivacySettings = {
  whoCanMessage: 'everyone',
  whoCanCall: 'friends',
  whoCanViewProfile: 'everyone',
  showOnlineStatus: true,
};

/**
 * Owns the `settings` collection. Reads are lazy-upserting: the first `GET`
 * for a user materialises a fully-defaulted document (defaults defined on the
 * schema mirror `settingsSchema`), so callers always receive the complete
 * `Settings` contract shape without a separate provisioning step.
 *
 * Updates are a SHALLOW-per-block deep merge: a partial `privacy` patch only
 * overwrites the provided keys (via dot-notation `$set`), leaving siblings —
 * and the other blocks — untouched.
 */
@Injectable()
export class SettingsService {
  constructor(
    @InjectModel(Settings.name) private readonly settingsModel: Model<SettingsDocument>,
  ) {}

  /**
   * READ-ONLY privacy block for a user, falling back to {@link DEFAULT_PRIVACY}
   * if they have never materialised a settings document. Unlike
   * {@link getOrCreate} this never writes — so reading another user's privacy
   * (e.g. when gating a profile view) can't create rows as a side effect.
   */
  async getPrivacy(userId: string): Promise<PrivacySettings> {
    if (!Types.ObjectId.isValid(userId)) {
      return { ...DEFAULT_PRIVACY };
    }
    const doc = await this.settingsModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .select('privacy')
      .lean()
      .exec();
    if (!doc?.privacy) {
      return { ...DEFAULT_PRIVACY };
    }
    return {
      whoCanMessage: doc.privacy.whoCanMessage ?? DEFAULT_PRIVACY.whoCanMessage,
      whoCanCall: doc.privacy.whoCanCall ?? DEFAULT_PRIVACY.whoCanCall,
      whoCanViewProfile: doc.privacy.whoCanViewProfile ?? DEFAULT_PRIVACY.whoCanViewProfile,
      showOnlineStatus: doc.privacy.showOnlineStatus ?? DEFAULT_PRIVACY.showOnlineStatus,
    };
  }

  /** Convenience: a user's `whoCanViewProfile` visibility (read-only). */
  async getProfileVisibility(userId: string): Promise<Visibility> {
    return (await this.getPrivacy(userId)).whoCanViewProfile;
  }

  /**
   * Convenience: whether a user exposes their live online status to OTHERS
   * (read-only, defaulting to `true`). When `false`, callers must present that
   * user as offline to anyone but themselves.
   */
  async getShowOnlineStatus(userId: string): Promise<boolean> {
    return (await this.getPrivacy(userId)).showOnlineStatus;
  }

  /** Fetch (creating defaults on first access) the user's settings. */
  async getOrCreate(userId: string): Promise<SettingsContract> {
    const doc = await this.settingsModel
      .findOneAndUpdate(
        { userId: new Types.ObjectId(userId) },
        { $setOnInsert: { userId: new Types.ObjectId(userId) } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
    return this.toContract(doc);
  }

  /**
   * Deep-merge a partial settings patch and return the full updated contract.
   * Nested blocks are merged key-by-key so omitted keys retain their value.
   */
  async update(userId: string, patch: UpdateSettingsDto): Promise<SettingsContract> {
    const set: Record<string, unknown> = {};

    if (patch.privacy) {
      for (const [key, value] of Object.entries(patch.privacy)) {
        set[`privacy.${key}`] = value;
      }
    }
    if (patch.notifications) {
      for (const [key, value] of Object.entries(patch.notifications)) {
        set[`notifications.${key}`] = value;
      }
    }
    if (patch.devices) {
      for (const [key, value] of Object.entries(patch.devices)) {
        set[`devices.${key}`] = value;
      }
    }
    if (patch.theme !== undefined) set.theme = patch.theme;
    if (patch.locale !== undefined) set.locale = patch.locale;

    // An empty patch must not produce an empty `$set` (MongoDB rejects it) — in
    // that case behave like a plain get-or-create.
    const update: Record<string, unknown> = {
      $setOnInsert: { userId: new Types.ObjectId(userId) },
    };
    if (Object.keys(set).length > 0) {
      update.$set = set;
    }

    const doc = await this.settingsModel
      .findOneAndUpdate({ userId: new Types.ObjectId(userId) }, update, {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      })
      .exec();
    return this.toContract(doc);
  }

  /** Map a settings document to the shared `Settings` contract shape. */
  private toContract(doc: SettingsDocument): SettingsContract {
    return {
      privacy: {
        whoCanMessage: doc.privacy.whoCanMessage,
        whoCanCall: doc.privacy.whoCanCall,
        whoCanViewProfile: doc.privacy.whoCanViewProfile,
        showOnlineStatus: doc.privacy.showOnlineStatus,
      },
      notifications: {
        pushEnabled: doc.notifications.pushEnabled,
        emailEnabled: doc.notifications.emailEnabled,
        friendRequests: doc.notifications.friendRequests,
        messages: doc.notifications.messages,
        gifts: doc.notifications.gifts,
      },
      devices: {
        preferredCameraId: doc.devices.preferredCameraId,
        preferredMicId: doc.devices.preferredMicId,
      },
      theme: doc.theme,
      locale: doc.locale,
    };
  }
}
