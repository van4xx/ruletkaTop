import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * A runtime APP SETTING override — one persisted key/value the admin panel can
 * change WITHOUT an API restart.
 *
 * WAVE-2 introduces this store (collection `app_settings`) so a subset of the
 * settings surface becomes live-toggleable. {@link SettingsService} merges the
 * env-derived defaults (which still need a restart) with the stored overrides
 * here (which take effect immediately). Only an explicit allow-list of keys is
 * accepted (env-baked / NEXT_PUBLIC_* flags can't change at runtime), so this
 * collection never shadows a secret or a build-time constant.
 *
 * `value` is mixed (boolean / number / string) to match the shared flag union.
 * `updatedBy` links the staff account that last changed it for the audit trail.
 */
@Schema({ collection: 'app_settings', timestamps: { createdAt: true, updatedAt: true } })
export class AppSetting {
  /**
   * Stable flag key (e.g. `MAINTENANCE_MODE`). Unique — one row per key.
   * The unique index is declared once via `.index()` below (not here) so Mongoose
   * doesn't emit a duplicate-index warning at boot.
   */
  @Prop({ required: true, trim: true, type: String })
  key!: string;

  /** The override value — boolean | number | string. */
  @Prop({ required: true, type: Object })
  value!: boolean | number | string;

  /** The staff account that last set it (audit link; null for system writes). */
  @Prop({ required: false, default: null, type: Types.ObjectId, ref: 'User' })
  updatedBy!: Types.ObjectId | null;

  // `createdAt` / `updatedAt` are added by `timestamps`.
}

export type AppSettingDocument = HydratedDocument<AppSetting>;

export const AppSettingSchema = SchemaFactory.createForClass(AppSetting);

// ── Indexes ──────────────────────────────────────────────────────────────────
// Unique, fast lookup by key (the merge + upsert path).
AppSettingSchema.index({ key: 1 }, { unique: true });
