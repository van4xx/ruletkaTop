import { z } from 'zod';
import { localeSchema, themeSchema } from './common';

export const visibilitySchema = z.enum(['everyone', 'friends', 'nobody']);
export type Visibility = z.infer<typeof visibilitySchema>;

export const privacySettingsSchema = z.object({
  whoCanMessage: visibilitySchema.default('everyone'),
  whoCanCall: visibilitySchema.default('everyone'),
  whoCanViewProfile: visibilitySchema.default('everyone'),
  showOnlineStatus: z.boolean().default(true),
});
export type PrivacySettings = z.infer<typeof privacySettingsSchema>;

export const notificationSettingsSchema = z.object({
  pushEnabled: z.boolean().default(true),
  emailEnabled: z.boolean().default(false),
  friendRequests: z.boolean().default(true),
  messages: z.boolean().default(true),
  gifts: z.boolean().default(true),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

export const deviceSettingsSchema = z.object({
  preferredCameraId: z.string().nullable().default(null),
  preferredMicId: z.string().nullable().default(null),
});
export type DeviceSettings = z.infer<typeof deviceSettingsSchema>;

export const settingsSchema = z.object({
  privacy: privacySettingsSchema,
  notifications: notificationSettingsSchema,
  devices: deviceSettingsSchema,
  theme: themeSchema.default('system'),
  locale: localeSchema.default('ru'),
});
export type Settings = z.infer<typeof settingsSchema>;

export const updateSettingsSchema = z
  .object({
    privacy: privacySettingsSchema.partial(),
    notifications: notificationSettingsSchema.partial(),
    devices: deviceSettingsSchema.partial(),
    theme: themeSchema,
    locale: localeSchema,
  })
  .partial();
export type UpdateSettingsDto = z.infer<typeof updateSettingsSchema>;
