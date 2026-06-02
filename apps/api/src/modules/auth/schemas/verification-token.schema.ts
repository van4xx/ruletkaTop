import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * What a {@link VerificationToken} authorises. Kept as a string-literal union
 * so one collection backs BOTH the email-verification and password-reset flows.
 */
export type VerificationTokenPurpose = 'email_verify' | 'password_reset';

/** Allowed purposes (enum guard for the schema). */
export const VERIFICATION_TOKEN_PURPOSES: readonly VerificationTokenPurpose[] = [
  'email_verify',
  'password_reset',
];

/**
 * A single-use, time-limited, HASHED token emailed to a user for either email
 * verification or password reset.
 *
 * The raw token is NEVER stored — only its SHA-256 hash, so a DB leak can't be
 * replayed as a working link. A token is "live" while `consumedAt` is null and
 * `expiresAt` is in the future; consuming it (verify / reset) stamps
 * `consumedAt`. Rows self-expire via a TTL index on `expiresAt`.
 *
 * Mirrors the {@link Session} schema's hash-only, TTL-reaped design.
 */
@Schema({ collection: 'verificationtokens', timestamps: true })
export class VerificationToken {
  /** Owning account. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId!: Types.ObjectId;

  /** SHA-256 hex digest of the raw token. Unique — primary lookup key. */
  @Prop({ required: true })
  tokenHash!: string;

  /** What presenting the token authorises. */
  @Prop({
    required: true,
    enum: VERIFICATION_TOKEN_PURPOSES,
    type: String,
  })
  purpose!: VerificationTokenPurpose;

  /** Absolute expiry; a TTL index removes the row at/after this instant. */
  @Prop({ required: true, type: Date })
  expiresAt!: Date;

  /** Set when the token has been used (verify / reset). Null while live. */
  @Prop({ required: false, default: null, type: Date })
  consumedAt!: Date | null;

  // `createdAt` / `updatedAt` are added by `timestamps: true`.
}

export type VerificationTokenDocument = HydratedDocument<VerificationToken>;

export const VerificationTokenSchema = SchemaFactory.createForClass(VerificationToken);

// ── Indexes ───────────────────────────────────────────────────────────────
// Fast, unique lookup by token hash (consume on verify / reset).
VerificationTokenSchema.index({ tokenHash: 1 }, { unique: true });
// Enumerate / invalidate a user's outstanding tokens of a given purpose
// (e.g. superseding older reset tokens when a new one is minted).
VerificationTokenSchema.index({ userId: 1, purpose: 1 });
// TTL: expire rows once `expiresAt` passes (MongoDB reaps within ~60s).
VerificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
