import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { KycStatus } from '@ruletka/shared-types';

import type {
  GetStatusResult,
  KycProvider,
  ParseWebhookResult,
  StartVerificationResult,
} from './kyc-provider.port';

/**
 * Veriff KYC adapter.
 *
 * REST host: `https://stationapi.veriff.com`.
 *
 * Outbound auth — every signed request carries:
 *  - `X-AUTH-CLIENT: <VERIFF_API_KEY>` (the API key from Veriff Station).
 *  - `X-HMAC-SIGNATURE: HEX(HMAC-SHA256(VERIFF_PRIVATE_KEY, rawBody))` of the
 *    JSON body being sent (an empty string for GET).
 *
 * Webhook auth — Veriff POSTs JSON with header
 *  - `X-HMAC-SIGNATURE`: hex SHA-256 HMAC of the raw body using
 *    `VERIFF_PRIVATE_KEY`. We compare constant-time and reject 401 on any
 *    mismatch.
 *
 * Like {@link SumsubProvider}, if credentials are missing this class still
 * constructs and {@link isConfigured} returns `false` so the orchestrator
 * routes to the noop adapter.
 */
@Injectable()
export class VeriffProvider implements KycProvider {
  readonly providerName = 'veriff' as const;
  private readonly logger = new Logger(VeriffProvider.name);

  private readonly baseUrl: string;
  /** `X-AUTH-CLIENT` value. Empty when unset. */
  private readonly apiKey: string;
  /** Shared secret used to sign outbound + verify inbound HMACs. Empty when unset. */
  private readonly secret: string;
  /** Hosted iframe origin. Veriff returns a `url` per-session that lives under this host. */
  private readonly stationOrigin: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (
      this.config.get<string>('VERIFF_BASE_URL', 'https://stationapi.veriff.com') ?? ''
    )
      .trim()
      .replace(/\/$/, '');
    this.apiKey = (this.config.get<string>('VERIFF_API_KEY', '') ?? '').trim();
    this.secret = (this.config.get<string>('VERIFF_PRIVATE_KEY', '') ?? '').trim();
    this.stationOrigin = (
      this.config.get<string>('VERIFF_STATION_ORIGIN', 'https://magic.veriff.me') ?? ''
    ).trim();
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0 && this.secret.length > 0;
  }

  /**
   * Open a Veriff session via `POST /v1/sessions`. Veriff echoes back a
   * `verification.url` the user opens in a new tab. The session id is the
   * webhook idempotency key (`externalId`).
   */
  async startVerification(userId: string, returnUrl: string): Promise<StartVerificationResult> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Veriff provider is not configured (missing VERIFF_API_KEY / VERIFF_PRIVATE_KEY)',
      );
    }
    const body = JSON.stringify({
      verification: {
        callback: returnUrl,
        // Veriff is happy with a minimal person blob — we are NOT collecting
        // PII server-side; the user enters their details directly in the
        // iframe. `vendorData` is the userId echo so the webhook can route.
        vendorData: userId,
      },
    });
    const res = await this.signedRequest('POST', '/v1/sessions', body);
    const parsed = (await safeJson(res)) as { verification?: { id?: string; url?: string } } | null;
    const sessionId = parsed?.verification?.id;
    const sessionUrl = parsed?.verification?.url;
    if (!sessionId || !sessionUrl) {
      throw new ServiceUnavailableException('Veriff did not return a session id/url');
    }
    return {
      externalId: sessionId,
      redirectUrl: sessionUrl,
      // Veriff sessions are valid for ~24h; we conservatively use 1h to mirror
      // SumSub so the UI's "expired" state is consistent across providers.
      expiresAt: Date.now() + 60 * 60 * 1000,
    };
  }

  /**
   * Verify the `X-HMAC-SIGNATURE` HMAC over the raw body and parse the
   * decision. Veriff's `verification.decision` webhook carries:
   *   { verification: { id, status, code, reason, decisionTime } }
   * — we map `status` ∈ `approved|declined|review|expired|abandoned` to our
   * `approved|rejected|pending|expired`.
   */
  async parseWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): Promise<ParseWebhookResult> {
    if (!this.secret) {
      throw new UnauthorizedException('Webhook verification unavailable');
    }
    const provided = pickHeader(headers, 'x-hmac-signature');
    if (!provided) {
      throw new UnauthorizedException('Missing X-HMAC-SIGNATURE header');
    }
    const expected = createHmac('sha256', this.secret).update(rawBody).digest('hex');
    if (!hexSafeEqual(provided, expected)) {
      throw new UnauthorizedException('Invalid X-HMAC-SIGNATURE signature');
    }

    const body = parseJson(rawBody);
    const verification = (body['verification'] ?? {}) as Record<string, unknown>;
    const sessionId = readString(verification, 'id') ?? readString(body, 'sessionId');
    if (!sessionId) {
      throw new UnauthorizedException('Veriff webhook missing verification.id');
    }
    const status = VeriffProvider.mapStatus(verification);
    const decidedAt =
      readDate(verification, 'decisionTime') ??
      readDate(verification, 'acceptanceTime') ??
      new Date();

    return {
      externalId: sessionId,
      status,
      decisionMeta: body,
      decidedAt,
    };
  }

  async getStatus(externalId: string): Promise<GetStatusResult> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('Veriff provider is not configured');
    }
    const path = `/v1/sessions/${encodeURIComponent(externalId)}/decision`;
    const res = await this.signedRequest('GET', path, '');
    const body = (await safeJson(res)) as Record<string, unknown> | null;
    const verification = body
      ? ((body['verification'] ?? {}) as Record<string, unknown>)
      : ({} as Record<string, unknown>);
    return {
      status: body ? VeriffProvider.mapStatus(verification) : 'pending',
      decisionMeta: body,
    };
  }

  /** Sign an outbound request and forward it. Throws on non-2xx. */
  private async signedRequest(method: 'GET' | 'POST', path: string, body: string): Promise<Response> {
    const sig = createHmac('sha256', this.secret).update(body).digest('hex');
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'X-AUTH-CLIENT': this.apiKey,
        'X-HMAC-SIGNATURE': sig,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: method === 'POST' && body.length > 0 ? body : undefined,
    });
    if (!res.ok) {
      const text = await safeText(res);
      this.logger.warn(`Veriff ${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
      throw new ServiceUnavailableException(
        `Veriff call failed: ${method} ${path} → ${res.status}`,
      );
    }
    return res;
  }

  /**
   * Map Veriff's verification.status to {@link KycStatus}.
   *
   * Veriff statuses: `approved | declined | resubmission_requested | review |
   * expired | abandoned`. We treat `review`/`resubmission_requested` as
   * `pending` (the platform will get a follow-up webhook once a human reviewer
   * lands a verdict), and `abandoned` collapses into `expired`.
   */
  static mapStatus(verification: Record<string, unknown>): KycStatus {
    const status = String(verification['status'] ?? '').toLowerCase();
    switch (status) {
      case 'approved':
        return 'approved';
      case 'declined':
        return 'rejected';
      case 'expired':
      case 'abandoned':
        return 'expired';
      case 'review':
      case 'resubmission_requested':
      case 'submitted':
      case 'created':
        return 'pending';
      default:
        return 'pending';
    }
  }
}

// ── small JSON / header helpers ────────────────────────────────────────────

function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const v = headers[key];
      if (Array.isArray(v)) return v[0] ?? null;
      return typeof v === 'string' && v.length > 0 ? v : null;
    }
  }
  return null;
}

function hexSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function parseJson(raw: Buffer): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function readDate(obj: Record<string, unknown>, key: string): Date | null {
  const v = obj[key];
  if (typeof v === 'number') {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  if (typeof v === 'string' && v.length > 0) {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
