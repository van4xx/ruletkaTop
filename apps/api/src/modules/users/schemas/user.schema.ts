import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import type { Role } from '@ruletka/shared-types';

/** Allowed account roles (kept in sync with `roleSchema` in shared-types). */
const USER_ROLES: readonly Role[] = ['user', 'moderator', 'admin'];

/**
 * Authentication & authorization record for an account. Owns the credential
 * (argon2 `passwordHash`), the coarse `role`, ban state and contact email/phone.
 *
 * Domain-presentation data (nickname, avatar, gender, …) lives on the separate
 * `Profile` document keyed by `userId`; this collection stays small and is the
 * single source of truth for "who can authenticate".
 */
@Schema({ collection: 'users', timestamps: true })
export class User {
  /**
   * Primary login identifier. Stored lower-cased and unique (the unique index
   * is declared explicitly below so we can document its intent).
   */
  @Prop({ required: true, lowercase: true, trim: true })
  email!: string;

  /** Optional E.164-ish phone; not unique (kept sparse-indexed for lookups). */
  @Prop({ required: false, default: null, type: String })
  phone!: string | null;

  /** Argon2id hash of the password. NEVER returned to clients or logged. */
  @Prop({ required: true, select: false })
  passwordHash!: string;

  /** Coarse RBAC role. Defaults to a regular `user`. */
  @Prop({ required: true, enum: USER_ROLES, default: 'user', type: String })
  role!: Role;

  /** Whether the account is banned (set by moderation). Blocks login. */
  @Prop({ required: true, default: false })
  isBanned!: boolean;

  /**
   * Free-text reason the account was banned (set alongside `isBanned` by the
   * moderation surface — e.g. "Upheld abuse report" or "Confirmed AI-flagged
   * violation"). Surfaced read-only in the admin ban list. `null` for accounts
   * that were never banned, or banned before reasons were captured. Additive —
   * nothing reads this to authenticate.
   */
  @Prop({ required: false, default: null, type: String })
  banReason!: string | null;

  /**
   * Whether the contact email has been confirmed via the emailed verification
   * link. Defaults to `false` at registration; flipped to `true` once the user
   * consumes a valid `email_verify` token. Additive — login does NOT require a
   * verified email (it only gates a "please verify" banner on the client).
   */
  @Prop({ required: true, default: false })
  emailVerified!: boolean;

  /**
   * Consent audit (152-ФЗ / GDPR). Set at registration when the user accepts
   * the Terms of Service and Privacy Policy; `null` for accounts created before
   * consent capture existed. Additive — nothing reads these to authenticate.
   */
  @Prop({ required: false, default: null, type: Date })
  acceptedTermsAt!: Date | null;

  @Prop({ required: false, default: null, type: Date })
  acceptedPrivacyAt!: Date | null;

  /**
   * Set when the account is erased/anonymized (152-ФЗ "right to be forgotten",
   * `DELETE /users/me`). A non-null value marks the row as a tombstone: the
   * email/phone are scrambled, the credential is rotated to an unusable value
   * and login is blocked. `null` for active accounts.
   */
  @Prop({ required: false, default: null, type: Date })
  deletedAt!: Date | null;

  // `createdAt` / `updatedAt` are added by `timestamps: true`.
}

export type UserDocument = HydratedDocument<User>;

export const UserSchema = SchemaFactory.createForClass(User);

// ── Indexes (PROJECT_SPEC §6) ──────────────────────────────────────────────
// Unique email for login + dedupe at registration.
UserSchema.index({ email: 1 }, { unique: true });
// Sparse phone lookups (only documents that set a phone are indexed).
UserSchema.index({ phone: 1 }, { sparse: true });
// Admin/moderation listings by role, newest first.
UserSchema.index({ role: 1, createdAt: -1 });
