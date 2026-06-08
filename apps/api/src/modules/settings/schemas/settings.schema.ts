import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import type {
  DeviceSettings,
  Locale,
  NotificationSettings,
  PrivacySettings,
  Theme,
  Visibility,
} from '@ruletka/shared-types';

const VISIBILITY: readonly Visibility[] = ['everyone', 'friends', 'nobody'];
const THEMES: readonly Theme[] = ['light', 'dark', 'system'];
const LOCALES: readonly Locale[] = ['ru', 'en'];

/**
 * Embedded privacy block. Defaults mirror `privacySettingsSchema` in
 * shared-types (single source of truth — kept in sync there).
 */
@Schema({ _id: false })
export class PrivacySettingsEntity implements PrivacySettings {
  @Prop({ required: true, enum: VISIBILITY, default: 'everyone', type: String })
  whoCanMessage!: Visibility;

  @Prop({ required: true, enum: VISIBILITY, default: 'everyone', type: String })
  whoCanCall!: Visibility;

  @Prop({ required: true, enum: VISIBILITY, default: 'everyone', type: String })
  whoCanViewProfile!: Visibility;

  @Prop({ required: true, default: true })
  showOnlineStatus!: boolean;
}

/** Embedded notification preferences (defaults mirror shared-types). */
@Schema({ _id: false })
export class NotificationSettingsEntity implements NotificationSettings {
  @Prop({ required: true, default: true })
  pushEnabled!: boolean;

  @Prop({ required: true, default: false })
  emailEnabled!: boolean;

  @Prop({ required: true, default: true })
  friendRequests!: boolean;

  @Prop({ required: true, default: true })
  messages!: boolean;

  @Prop({ required: true, default: true })
  gifts!: boolean;
}

/** Embedded device preferences (defaults mirror shared-types). */
@Schema({ _id: false })
export class DeviceSettingsEntity implements DeviceSettings {
  @Prop({ required: false, default: null, type: String })
  preferredCameraId!: string | null;

  @Prop({ required: false, default: null, type: String })
  preferredMicId!: string | null;
}

const PrivacySettingsSchema = SchemaFactory.createForClass(PrivacySettingsEntity);
const NotificationSettingsSchema = SchemaFactory.createForClass(NotificationSettingsEntity);
const DeviceSettingsSchema = SchemaFactory.createForClass(DeviceSettingsEntity);

/**
 * Per-user application settings, keyed 1:1 by `userId`. All blocks default to
 * the values defined in `settingsSchema` (shared-types), so a freshly-created
 * document is immediately valid against that contract.
 */
@Schema({ collection: 'settings', timestamps: true })
export class Settings {
  /** Owning account. Unique — index declared below. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId!: Types.ObjectId;

  @Prop({ type: PrivacySettingsSchema, default: () => ({}) })
  privacy!: PrivacySettingsEntity;

  @Prop({ type: NotificationSettingsSchema, default: () => ({}) })
  notifications!: NotificationSettingsEntity;

  @Prop({ type: DeviceSettingsSchema, default: () => ({}) })
  devices!: DeviceSettingsEntity;

  @Prop({ required: true, enum: THEMES, default: 'system', type: String })
  theme!: Theme;

  @Prop({ required: true, enum: LOCALES, default: 'ru', type: String })
  locale!: Locale;
}

export type SettingsDocument = HydratedDocument<Settings>;

export const SettingsSchema = SchemaFactory.createForClass(Settings);

// ── Indexes (PROJECT_SPEC §6) ──────────────────────────────────────────────
// One settings document per account, and the primary lookup key.
SettingsSchema.index({ userId: 1 }, { unique: true });
