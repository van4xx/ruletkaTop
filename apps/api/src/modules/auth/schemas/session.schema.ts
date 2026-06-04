import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * A persisted refresh-token session (one row per issued refresh token).
 *
 * The refresh token itself is NEVER stored — only its SHA-256 hash, so a DB
 * leak can't be replayed. Rotation links rows by `family`: presenting a token
 * mints a new row and marks the old one `replacedByHash`. Presenting an
 * already-replaced (or revoked) token is treated as REUSE → the whole family
 * is revoked (see `AuthService.refresh`).
 *
 * Rows self-expire via a TTL index on `expiresAt`.
 */
@Schema({ collection: 'sessions', timestamps: true })
export class Session {
  /** Owning account. */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId!: Types.ObjectId;

  /** SHA-256 hex digest of the refresh token. Unique — primary lookup key. */
  @Prop({ required: true })
  tokenHash!: string;

  /** Rotation family id (shared across all rotations of one login). */
  @Prop({ required: true })
  family!: string;

  /** Absolute expiry; a TTL index removes the row at/after this instant. */
  @Prop({ required: true, type: Date })
  expiresAt!: Date;

  /** Set when this token has been rotated out (points at its successor). */
  @Prop({ required: false, default: null, type: String })
  replacedByHash!: string | null;

  /**
   * When this token was rotated out (set alongside `replacedByHash`). Lets the
   * refresh path apply a short ROTATION GRACE: a just-rotated token presented
   * again within the grace window is a benign concurrent/double refresh (two
   * tabs, a reload racing an open tab) and is re-issued idempotently against the
   * successor instead of burning the whole family. A replay LONG after rotation
   * (or any explicitly revoked token) still trips genuine reuse detection.
   * Additive + nullable (defaults null), so no migration is required.
   */
  @Prop({ required: false, default: null, type: Date })
  replacedAt!: Date | null;

  /** Set when explicitly revoked (logout) or revoked due to reuse detection. */
  @Prop({ required: false, default: null, type: Date })
  revokedAt!: Date | null;

  /** Best-effort client context for audit/security surfaces. */
  @Prop({ required: false, default: null, type: String })
  ip!: string | null;

  @Prop({ required: false, default: null, type: String })
  userAgent!: string | null;

  @Prop({ required: false, default: null, type: String })
  device!: string | null;
}

export type SessionDocument = HydratedDocument<Session>;

export const SessionSchema = SchemaFactory.createForClass(Session);

// ── Indexes (PROJECT_SPEC §6) ──────────────────────────────────────────────
// Fast, unique lookup by token hash (rotation + reuse detection).
SessionSchema.index({ tokenHash: 1 }, { unique: true });
// Revoke / enumerate all sessions in a rotation family or for a user.
SessionSchema.index({ family: 1 });
SessionSchema.index({ userId: 1 });
// TTL: expire rows once `expiresAt` passes (MongoDB reaps within ~60s).
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
