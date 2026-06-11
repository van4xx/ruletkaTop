import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import type { KycProviderName, KycStatus } from '@ruletka/shared-types';

const PROVIDERS: readonly KycProviderName[] = ['sumsub', 'veriff', 'noop'];
const STATUSES: readonly KycStatus[] = ['pending', 'approved', 'rejected', 'expired'];

/**
 * One row per upstream KYC session.
 *
 * `externalId` is the provider's applicant / session id and is the WEBHOOK
 * IDEMPOTENCY KEY: a partial-unique compound index on `(provider, externalId,
 * status)` lets a redelivered webhook collide on the same terminal row instead
 * of writing a second decision, mirroring the wallet's `(type, refId)` ledger
 * pattern used by the payments idempotency layer.
 *
 * `decisionMeta` is the verbatim provider decision blob (review answer + flags
 * for audit). The platform NEVER reads inside it to authorise — `status` is the
 * single source of truth and is the only field the matchmaking gate or the
 * `/kyc/me` projection consults.
 */
@Schema({ collection: 'kycverifications', timestamps: true })
export class KycVerification {
  /** Owning account (one user can have many rows — retries/expirations). */
  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId!: Types.ObjectId;

  /** Active provider for the session (set on start; mirrored by webhook). */
  @Prop({ required: true, enum: PROVIDERS, type: String })
  provider!: KycProviderName;

  /** Lifecycle state — see `kycStatusSchema`. */
  @Prop({ required: true, enum: STATUSES, default: 'pending', type: String })
  status!: KycStatus;

  /** Provider-side applicant / session id; unique per provider. */
  @Prop({ required: true, type: String })
  externalId!: string;

  /** When the user pressed "start verification". */
  @Prop({ required: true, type: Date, default: () => new Date() })
  requestedAt!: Date;

  /** When the provider returned a terminal decision (`null` while pending). */
  @Prop({ required: false, default: null, type: Date })
  decidedAt!: Date | null;

  /** Raw provider decision blob (audit). Never used for authorisation. */
  @Prop({ required: false, default: null, type: Object })
  decisionMeta!: Record<string, unknown> | null;
}

export type KycVerificationDocument = HydratedDocument<KycVerification>;

export const KycVerificationSchema = SchemaFactory.createForClass(KycVerification);

// ── Indexes ────────────────────────────────────────────────────────────────
// Provider-side id is the webhook idempotency key. Unique PER PROVIDER so the
// two stubs can coexist (`sumsub:appl-123` is unrelated to `veriff:sess-123`).
KycVerificationSchema.index({ provider: 1, externalId: 1 }, { unique: true });
// User's KYC history; the controller's GET /kyc/me uses the newest row.
KycVerificationSchema.index({ userId: 1, createdAt: -1 });
