import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * A device/network FINGERPRINT associated with a banned account, used for
 * ban-evasion detection.
 *
 * When a user is banned (via the moderation flow), the fingerprints seen on
 * that account's sessions are recorded here. On a subsequent register/login the
 * caller's freshly-computed fingerprint is looked up; an ACTIVE row blocks the
 * action so a banned user can't trivially re-register from the same device/IP.
 *
 * The fingerprint is a SHA-256 hex of (IP + User-Agent) — see
 * `FingerprintService.compute`. We store only the hash (never the raw IP/UA),
 * so this collection carries no directly-readable PII.
 *
 * `expiresAt` lets a fingerprint ban auto-lift (mirrors temporary account bans);
 * a `null` expiry means the row never auto-expires (permanent). A partial TTL
 * index reaps rows once a non-null `expiresAt` passes.
 */
@Schema({ collection: 'bannedfingerprints', timestamps: true })
export class BannedFingerprint {
  /** SHA-256 hex of (IP + '|' + User-Agent). Unique — the primary lookup key. */
  @Prop({ required: true, unique: true })
  fingerprint!: string;

  /** The account whose ban created/last-touched this row (audit link). */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId!: Types.ObjectId;

  /**
   * When this fingerprint ban lifts. `null` = permanent (never auto-expires).
   * A partial TTL index removes the row at/after this instant when non-null.
   */
  @Prop({ required: false, default: null, type: Date })
  expiresAt!: Date | null;
}

export type BannedFingerprintDocument = HydratedDocument<BannedFingerprint>;

export const BannedFingerprintSchema =
  SchemaFactory.createForClass(BannedFingerprint);

// ── Indexes ─────────────────────────────────────────────────────────────────
// Unique, fast lookup by fingerprint hash (the register/login gate).
BannedFingerprintSchema.index({ fingerprint: 1 }, { unique: true });
// TTL: reap only rows that carry a (non-null) expiry, so permanent bans
// (expiresAt: null) are never auto-removed. MongoDB skips docs whose indexed
// field is null/missing for expireAfterSeconds: 0, but the partial filter makes
// the intent explicit and avoids scanning permanent rows.
BannedFingerprintSchema.index(
  { expiresAt: 1 },
  {
    expireAfterSeconds: 0,
    partialFilterExpression: { expiresAt: { $type: 'date' } },
  },
);
