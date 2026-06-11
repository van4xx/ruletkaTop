import { randomUUID } from 'node:crypto';

import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  GetStatusResult,
  KycProvider,
  ParseWebhookResult,
  StartVerificationResult,
} from './kyc-provider.port';

/**
 * No-op KYC adapter — the safety net.
 *
 * Used when:
 * - `KYC_PROVIDER=noop` is explicitly chosen (dev/CI flow);
 * - `KYC_PROVIDER=sumsub|veriff` is set but the chosen adapter is missing
 *   credentials (the orchestrator silently falls back here so onboarding
 *   keeps working).
 *
 * Semantics:
 * - In DEV (`NODE_ENV !== 'production'`) `startVerification` returns an
 *   immediately-approved session — the orchestrator marks the row `approved`
 *   on the same call so the matchmaking gate (when opt-in) lets the user in.
 * - In PRODUCTION the noop refuses to issue a verification (throws 403). A
 *   production deployment that ends up on noop is a misconfiguration and the
 *   error message is the load-bearing signal. The matchmaking gate stays OFF
 *   by default (`KYC_REQUIRED` falsy) so this never blocks unrelated users —
 *   only the user actively pressing "Start verification" sees the error.
 *
 * Webhook and getStatus return `expired` / null — the noop never produces real
 * decisions, and the orchestrator never opens a webhook against it.
 */
@Injectable()
export class NoopKycProvider implements KycProvider {
  readonly providerName = 'noop' as const;
  private readonly logger = new Logger(NoopKycProvider.name);

  constructor(private readonly config: ConfigService) {}

  /** Always "configured" — the noop never needs credentials. */
  isConfigured(): boolean {
    return true;
  }

  async startVerification(userId: string, _returnUrl: string): Promise<StartVerificationResult> {
    if (this.isProd()) {
      this.logger.error(
        'NoopKycProvider.startVerification called in production — KYC_PROVIDER misconfigured',
      );
      throw new ForbiddenException(
        'Age verification is not configured on this deployment. Please contact support.',
      );
    }
    const externalId = `noop-${randomUUID()}`;
    this.logger.debug(`noop start: user=${userId} → externalId=${externalId} (auto-approved in dev)`);
    return {
      externalId,
      // No real iframe — return a /verified marker the web tile can pretend-open
      // in a new tab; the user comes back, the row is already `approved` and the
      // `/kyc/me` refetch shows the verified state.
      redirectUrl: 'about:blank#noop-kyc-auto-approved',
      // 1 hour from now (irrelevant — the noop's session is already terminal).
      expiresAt: Date.now() + 60 * 60 * 1000,
    };
  }

  async parseWebhook(): Promise<ParseWebhookResult> {
    // The noop never has the real provider POST a webhook against it. If
    // someone hits POST /kyc/webhook/noop, return an explicit "expired" so the
    // orchestrator is a no-op on the row.
    return {
      externalId: 'noop-no-webhook',
      status: 'expired',
      decisionMeta: { reason: 'noop provider has no webhook flow' },
    };
  }

  async getStatus(externalId: string): Promise<GetStatusResult> {
    // In dev the noop's start always auto-approves locally; the orchestrator
    // doesn't poll status. Surface an expired marker so a stray call is safe.
    return {
      status: this.isProd() ? 'expired' : 'approved',
      decisionMeta: { externalId, reason: 'noop status — not authoritative' },
    };
  }

  /** Whether this process is running in production. Read at boot via env. */
  private isProd(): boolean {
    return (this.config.get<string>('NODE_ENV', 'development') ?? 'development') === 'production';
  }
}
