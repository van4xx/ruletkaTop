import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import type { Badge, CountryCode, Gender, Locale } from '@ruletka/shared-types';

const GENDERS: readonly Gender[] = ['male', 'female', 'other'];
const BADGES: readonly Badge[] = ['premium', 'verified', 'top', 'staff'];
const LOCALES: readonly Locale[] = ['ru', 'en'];

/**
 * Public-facing presentation record for an account, keyed 1:1 by `userId`.
 *
 * Split from `User` so the auth/credential collection stays minimal and this
 * (frequently-read) document can carry display fields, premium denormalisation
 * and the `profileViews` counter. `birthDate` is the source of truth for age —
 * age (18+) is derived at read time, never stored, so it can't drift.
 */
@Schema({ collection: 'profiles', timestamps: true })
export class Profile {
  /** Owning account. Unique (one profile per user) — index declared below. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId!: Types.ObjectId;

  /** Unique display handle (3–24 chars, `[a-zA-Z0-9_]`). */
  @Prop({ required: true, trim: true })
  nickname!: string;

  /** Avatar URL or `null` when unset. */
  @Prop({ required: false, default: null, type: String })
  avatarUrl!: string | null;

  /** Free-text status line (≤140 chars) or `null`. */
  @Prop({ required: false, default: null, type: String })
  status!: string | null;

  @Prop({ required: true, enum: GENDERS, type: String })
  gender!: Gender;

  /**
   * Date of birth. Stored as a `Date`; age is computed on read and 18+ is
   * enforced at registration / profile update by the service layer.
   */
  @Prop({ required: true, type: Date })
  birthDate!: Date;

  /**
   * ISO 3166-1 alpha-2 country code (uppercase), or `null` when unset.
   * OPTIONAL: registration no longer collects a country, so new profiles may
   * have none. A null country means "no region set" — discovery/matchmaking
   * treat it as no geographic preference.
   */
  @Prop({ required: false, default: null, type: String })
  country!: CountryCode | null;

  /** Spoken languages (subset of supported locales). */
  @Prop({ required: true, type: [String], enum: LOCALES, default: [] })
  languages!: Locale[];

  /**
   * Free-form interest tags (e.g. `music`, `gaming`, `travel`) used for smart,
   * interest-aware matchmaking. Normalised on write (trimmed, lowercased,
   * deduped, capped at 10). Existing profiles default to `[]` and still match —
   * interests only PRIORITISE peers unless the joiner opts into
   * `sharedInterestsOnly`.
   */
  @Prop({ required: true, type: [String], default: [] })
  interests!: string[];

  /** Earned/granted badges shown on the profile. */
  @Prop({ required: true, type: [String], enum: BADGES, default: [] })
  badges!: Badge[];

  /**
   * Denormalised premium flag for cheap reads. The economy/payments domain is
   * authoritative; this mirrors it for profile rendering.
   */
  @Prop({ required: true, default: false })
  isPremium!: boolean;

  /** When the current premium period ends, or `null` if not premium. */
  @Prop({ required: false, default: null, type: Date })
  premiumUntil!: Date | null;

  /** Lifetime non-owner profile views. */
  @Prop({ required: true, default: 0, min: 0 })
  profileViews!: number;

  // `createdAt` / `updatedAt` added by `timestamps: true`.
}

export type ProfileDocument = HydratedDocument<Profile>;

export const ProfileSchema = SchemaFactory.createForClass(Profile);

// ── Indexes (PROJECT_SPEC §6) ──────────────────────────────────────────────
// One profile per account, and the primary lookup key.
ProfileSchema.index({ userId: 1 }, { unique: true });
// Unique, case-sensitive handle (validation enforces the charset).
ProfileSchema.index({ nickname: 1 }, { unique: true });
// Country/gender faceting for discovery surfaces.
ProfileSchema.index({ country: 1, gender: 1 });
