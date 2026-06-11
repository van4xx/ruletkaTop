import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import type {
  KycMeResponse,
  KycProviderName,
  KycStartResponse,
  KycStatus,
  KycVerification as KycVerificationDto,
} from '@ruletka/shared-types';

import { Profile, ProfileDocument } from '../profiles/schemas/profile.schema';
import { KYC_PROVIDER, type KycProvider } from './providers/kyc-provider.port';
import {
  KycVerification,
  KycVerificationDocument,
} from './schemas/kyc-verification.schema';

/**
 * Orchestrates the KYC port — one row per session, one webhook fan-in, and the
 * `Profile.ageVerifiedAt` stamp that unlocks the (opt-in) matchmaking gate.
 *
 * The active provider is injected via {@link KYC_PROVIDER}; the picking
 * happens in {@link KycModule}'s factory (env-driven, credentials-checked,
 * with fallback to {@link NoopKycProvider} when the chosen provider is missing
 * credentials). This service stays provider-agnostic.
 *
 * ── Idempotency model ──────────────────────────────────────────────────────
 * `(provider, externalId)` is unique per row at the schema level. The webhook
 * handler's flow is:
 *   1. parse + signature-verify via the provider adapter (throws 401 on bad);
 *   2. upsert the row by `(provider, externalId)` with `$set` of the new
 *      status + decisionMeta + decidedAt;
 *   3. on terminal `approved`, stamp the owning {@link Profile.ageVerifiedAt}
 *      to the provider's decision timestamp (carried in the webhook body) —
 *      not a server-side clock, so the service stays clock-injection-free.
 *
 * Redelivery: same (provider, externalId) hits the same row; `$set` is the same
 * shape; the Profile stamp is taken from the body, which is constant for the
 * same decision. Net effect: redelivery is a no-op on the Profile.
 */
@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  /**
   * Frontend origin the provider should redirect the user back to after the
   * iframe finishes (UX only; the decision still travels via the webhook).
   * Falls back to the API origin when `WEB_BASE_URL` is unset (still valid).
   */
  private readonly returnUrlBase: string;

  constructor(
    @Inject(KYC_PROVIDER) private readonly provider: KycProvider,
    @InjectModel(KycVerification.name)
    private readonly kycModel: Model<KycVerificationDocument>,
    @InjectModel(Profile.name) private readonly profileModel: Model<ProfileDocument>,
    private readonly config: ConfigService,
  ) {
    const web = (this.config.get<string>('WEB_BASE_URL', '') ?? '').trim();
    const api = (this.config.get<string>('PUBLIC_API_URL', 'http://localhost:4000') ?? '').trim();
    this.returnUrlBase = web.length > 0 ? web : api;
  }

  /** The active provider's machine name (for diagnostics / responses). */
  get activeProvider(): KycProviderName {
    return this.provider.providerName;
  }

  /**
   * Begin a verification for `userId`. Writes a `pending` row, asks the
   * provider to open a session, and returns the redirect URL. On the noop
   * provider (DEV) the row is INSTANTLY upgraded to `approved` and the
   * Profile.ageVerifiedAt stamp lands so the matchmaking gate (opt-in) lets
   * the user in without an external round-trip.
   */
  async startVerification(userId: string): Promise<KycStartResponse> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user id');
    }
    const returnUrl = `${this.returnUrlBase}/settings#account`;
    const result = await this.provider.startVerification(userId, returnUrl);

    const now = new Date();
    const initialStatus: KycStatus = this.provider.providerName === 'noop' ? 'approved' : 'pending';

    // Upsert the row by the provider's externalId so a retry from the same user
    // doesn't fork the audit trail. We use `$setOnInsert` for `requestedAt` so
    // the original request time survives a retry; the `status` is set fresh.
    await this.kycModel
      .findOneAndUpdate(
        { provider: this.provider.providerName, externalId: result.externalId },
        {
          $setOnInsert: {
            userId: new Types.ObjectId(userId),
            provider: this.provider.providerName,
            externalId: result.externalId,
            requestedAt: now,
          },
          $set: {
            status: initialStatus,
            decidedAt: initialStatus === 'approved' ? now : null,
            decisionMeta:
              initialStatus === 'approved'
                ? { reason: 'noop auto-approve (dev)' }
                : null,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    // DEV path: also stamp the Profile so the gate considers the user verified
    // right away. The stamp goes through the same helper so the prod webhook
    // path and the dev shortcut share semantics + audit.
    if (initialStatus === 'approved') {
      await this.markProfileVerified(userId, now);
    }

    return {
      provider: this.provider.providerName,
      status: initialStatus,
      externalId: result.externalId,
      redirectUrl: result.redirectUrl,
      expiresAt: result.expiresAt,
    };
  }

  /**
   * Latest verification row for `userId` (or `null` if they never started).
   * Used by `GET /kyc/me` and the matchmaking gate's "do we have a decision?"
   * cross-check (the Profile.ageVerifiedAt is the source of truth, but the
   * row lets the UI render "pending" / "rejected" states).
   */
  async getMyVerification(userId: string): Promise<KycMeResponse> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user id');
    }
    const profile = await this.profileModel
      .findOne({ userId: new Types.ObjectId(userId) }, { ageVerifiedAt: 1 })
      .lean()
      .exec();
    const ageVerified =
      profile?.ageVerifiedAt instanceof Date && !Number.isNaN(profile.ageVerifiedAt.getTime());

    const row = await this.kycModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    if (!row) {
      return { ageVerified: Boolean(ageVerified), verification: null };
    }
    return {
      ageVerified: Boolean(ageVerified),
      verification: KycService.toDto(row),
    };
  }

  /**
   * Handle an inbound webhook from `providerName`. The controller passes the
   * RAW body buffer (Nest's `rawBody: true`) plus the headers; this method:
   * 1. Verifies signature via the adapter (throws 401 on bad).
   * 2. Upserts the row by `(provider, externalId)` with the new status.
   * 3. On `approved`, marks the owning Profile's ageVerifiedAt with the
   *    provider's decision timestamp.
   *
   * Returns the new row's status for the controller's ack.
   */
  async handleWebhook(
    providerName: KycProviderName,
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): Promise<{ ok: true; status: KycStatus }> {
    // Reject webhooks for a provider that isn't the active one — a stale
    // SumSub webhook hitting an instance configured for Veriff would otherwise
    // succeed in a signature check against the WRONG secret and be ignored,
    // which is hard to debug. Fail fast with a clear 400.
    if (providerName !== this.provider.providerName) {
      throw new BadRequestException(
        `KYC provider mismatch: webhook=${providerName} active=${this.provider.providerName}`,
      );
    }
    const parsed = await this.provider.parseWebhook(headers, rawBody);

    const existing = await this.kycModel
      .findOne({ provider: providerName, externalId: parsed.externalId })
      .exec();
    if (!existing) {
      // A webhook for an unknown externalId is suspicious (forged or out-of-
      // band-created session). Log + 404 so the provider retries are bounded.
      this.logger.warn(
        `KYC webhook for unknown externalId provider=${providerName} id=${parsed.externalId}`,
      );
      throw new NotFoundException('Unknown KYC session');
    }

    // Idempotent terminal-state guard: if the row is already terminal AND the
    // new status matches, treat as redelivery and short-circuit (no Profile
    // re-stamp, no log noise). If the status DIFFERS on an already-terminal
    // row, log loudly — a flip from `approved` → `rejected` would be a real
    // provider event and worth recording.
    const wasTerminal =
      existing.status === 'approved' ||
      existing.status === 'rejected' ||
      existing.status === 'expired';
    if (wasTerminal && existing.status === parsed.status) {
      return { ok: true, status: existing.status };
    }
    if (wasTerminal && existing.status !== parsed.status) {
      this.logger.warn(
        `KYC status flip on terminal row provider=${providerName} id=${parsed.externalId} ` +
          `was=${existing.status} new=${parsed.status}`,
      );
    }

    // Stamp the row. The decision timestamp from the webhook body is used as
    // the row's `decidedAt` (and, on `approved`, as the Profile's
    // ageVerifiedAt) — so the service is testable without a clock injection.
    const decidedAt = parsed.decidedAt ?? new Date();
    existing.status = parsed.status;
    existing.decidedAt = decidedAt;
    existing.decisionMeta = parsed.decisionMeta;
    await existing.save();

    if (parsed.status === 'approved') {
      await this.markProfileVerified(existing.userId.toString(), decidedAt);
    }

    return { ok: true, status: parsed.status };
  }

  /**
   * Stamp Profile.ageVerifiedAt — idempotent (only sets when null OR earlier).
   *
   * Using a guarded `$set` rather than an unconditional write means a
   * redelivered approve webhook never "moves" the stamp forward by accident,
   * and a once-verified account is never un-verified by a downstream bug. The
   * matchmaking gate reads ageVerifiedAt as a boolean — exact ms is audit only.
   */
  private async markProfileVerified(userId: string, when: Date): Promise<void> {
    await this.profileModel
      .findOneAndUpdate(
        {
          userId: new Types.ObjectId(userId),
          $or: [{ ageVerifiedAt: null }, { ageVerifiedAt: { $exists: false } }],
        },
        { $set: { ageVerifiedAt: when } },
      )
      .exec();
  }

  /** Project a stored row to the wire DTO shape (ISO dates, string ids). */
  private static toDto(row: {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    provider: KycProviderName;
    status: KycStatus;
    externalId: string;
    requestedAt: Date;
    decidedAt: Date | null;
    decisionMeta: Record<string, unknown> | null;
  }): KycVerificationDto {
    return {
      id: row._id.toString(),
      userId: row.userId.toString(),
      provider: row.provider,
      status: row.status,
      externalId: row.externalId,
      requestedAt: row.requestedAt.toISOString(),
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
      decisionMeta: row.decisionMeta,
    };
  }
}
