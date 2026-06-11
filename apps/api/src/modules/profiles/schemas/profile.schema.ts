import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import type { Badge, CountryCode, Gender, Locale } from '@ruletka/shared-types';
import { DEFAULT_COVER_ID } from '@ruletka/shared-types';

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

  /**
   * Selected profile-cover cosmetic id (denormalised, read on every hero
   * render and surfaced on the public profile). Defaults to the free `aurora`
   * cover; profiles predating the field fall back to it on read.
   */
  @Prop({ required: true, default: DEFAULT_COVER_ID, type: String })
  activeCover!: string;

  /**
   * Owned PAID cover ids (private inventory; never projected onto the public
   * profile). The two FREE covers are implicitly owned and never stored here —
   * ownership is `FREE_COVER_IDS ∪ ownedCovers`. Appended to on purchase.
   */
  @Prop({ required: true, default: [], type: [String] })
  ownedCovers!: string[];

  /**
   * Selected avatar-frame cosmetic id (a decorative ring drawn around the
   * avatar). Defaults to `null` — i.e. no frame — because, unlike a cover,
   * wearing a frame is optional and the avatar reads fine bare. The owner
   * may equip a free/owned frame or unequip back to `null` at any time.
   */
  @Prop({ required: false, default: null, type: String })
  equippedFrameId!: string | null;

  /**
   * Owned PAID frame ids (private inventory; never projected onto the public
   * profile). The two FREE frames are implicitly owned and never stored here —
   * ownership is `FREE_FRAME_IDS ∪ ownedFrames`. Appended to on purchase.
   */
  @Prop({ required: true, default: [], type: [String] })
  ownedFrames!: string[];

  /** Lifetime non-owner profile views. */
  @Prop({ required: true, default: 0, min: 0 })
  profileViews!: number;

  /**
   * When the user passed KYC age verification (provider stamped them 18+), or
   * `null` while unverified. Set ONLY by the KYC orchestrator from the
   * provider's webhook decision timestamp — never from a server-side clock,
   * so the value reflects the truth of the upstream decision.
   *
   * The matchmaking gate (opt-in via `KYC_REQUIRED=true`) treats this as a
   * boolean: any non-null Date means "verified". Once set, the value is
   * immutable (the KYC service uses a guarded `$set` that only writes when
   * the field is null), so a redelivered webhook never moves the stamp and a
   * downstream bug can never un-verify an account.
   *
   * Additive — pre-existing profiles default to `null` (treated as "not yet
   * verified"). The gate stays OFF until `KYC_REQUIRED` is set, so this
   * change ships without breaking any existing user flow.
   */
  @Prop({ required: false, default: null, type: Date })
  ageVerifiedAt!: Date | null;

  // `createdAt` / `updatedAt` added by `timestamps: true`.
}

export type ProfileDocument = HydratedDocument<Profile>;

export const ProfileSchema = SchemaFactory.createForClass(Profile);

// ── Indexes (PROJECT_SPEC §6) ──────────────────────────────────────────────
// One profile per account, and the primary lookup key.
ProfileSchema.index({ userId: 1 }, { unique: true });
// Unique, case-sensitive handle (validation enforces the charset). This is the
// integrity index — it guarantees no two profiles share a nickname (binary
// comparison) and is NOT used by the case-insensitive search below.
ProfileSchema.index({ nickname: 1 }, { unique: true });
// Case-INSENSITIVE nickname index for `GET /profiles/search`'s prefix lookup.
// `strength: 2` makes comparisons case-insensitive, so a collation-scoped
// anchored prefix query (see `ProfilesService.searchProfiles`) is served by an
// indexed RANGE scan instead of the `_id` full-index-scan + per-doc regex
// fallback the planner is otherwise forced into (a case-insensitive `$regex`
// cannot use the binary `nickname_1` index). Non-unique: uniqueness is owned by
// the case-sensitive index above.
ProfileSchema.index(
  { nickname: 1 },
  { name: 'nickname_ci', collation: { locale: 'en', strength: 2 } },
);
// Country/gender faceting for discovery surfaces.
ProfileSchema.index({ country: 1, gender: 1 });
