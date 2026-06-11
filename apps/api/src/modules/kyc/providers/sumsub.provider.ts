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
 * SumSub (Sum & Substance) KYC adapter.
 *
 * REST host: `https://api.sumsub.com`.
 *
 * Outbound auth — every signed request carries three headers (per SumSub docs,
 * https://docs.sumsub.com/reference/authentication):
 *  - `X-App-Token: <SUMSUB_APP_TOKEN>`
 *  - `X-App-Access-Sig: HMAC-SHA256(SUMSUB_SECRET_KEY, ts + method + path + body)`
 *  - `X-App-Access-Ts: <unix seconds>`
 *
 * Webhook auth — SumSub POSTs JSON with header
 *  - `X-Payload-Digest`: hex SHA-256 HMAC of the EXACT raw body using
 *    `SUMSUB_SECRET_KEY`. We compare constant-time and reject 401 on any
 *    mismatch.
 *
 * Configuration tolerance: if `SUMSUB_APP_TOKEN` or `SUMSUB_SECRET_KEY` is
 * missing the orchestrator picks the noop adapter instead — this stub still
 * constructs cleanly and returns informative errors if accidentally invoked.
 */
@Injectable()
export class SumsubProvider implements KycProvider {
  readonly providerName = 'sumsub' as const;
  private readonly logger = new Logger(SumsubProvider.name);

  /** Base REST host. Overridable via env for staging. */
  private readonly baseUrl: string;
  /** `X-App-Token` value. Empty when not configured. */
  private readonly appToken: string;
  /** `X-App-Access-Sig` HMAC secret AND the webhook digest secret. Empty when unset. */
  private readonly secret: string;
  /** Verification level (SumSub flowId / levelName). `id-and-liveness` is the platform default. */
  private readonly levelName: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (this.config.get<string>('SUMSUB_BASE_URL', 'https://api.sumsub.com') ?? '')
      .trim()
      .replace(/\/$/, '');
    this.appToken = (this.config.get<string>('SUMSUB_APP_TOKEN', '') ?? '').trim();
    this.secret = (this.config.get<string>('SUMSUB_SECRET_KEY', '') ?? '').trim();
    this.levelName = (
      this.config.get<string>('SUMSUB_LEVEL_NAME', 'id-and-liveness') ?? 'id-and-liveness'
    ).trim();
  }

  isConfigured(): boolean {
    return this.appToken.length > 0 && this.secret.length > 0;
  }

  /**
   * Open a SumSub applicant + access token. The flow is:
   * 1. `POST /resources/applicants?levelName=<level>` to create / fetch the
   *    applicant by external `userId`;
   * 2. `POST /resources/accessTokens?userId=<userId>&levelName=<level>&ttlInSecs=3600`
   *    to mint a short-lived token the WebSDK consumes;
   * 3. Build a hosted URL (`https://in.sumsub.com/idensic/l/#/<token>`) the
   *    user opens in a NEW TAB; SumSub redirects back via `returnUrl`.
   *
   * If credentials are missing this method throws an informative
   * `ServiceUnavailableException` so the controller surfaces a 503 (and the
   * web tile renders a "не настроено" hint).
   */
  async startVerification(userId: string, _returnUrl: string): Promise<StartVerificationResult> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'SumSub provider is not configured (missing SUMSUB_APP_TOKEN / SUMSUB_SECRET_KEY)',
      );
    }

    // (1) Ensure the applicant exists. SumSub treats `externalUserId` as the
    // join key, so a redelivery / second start for the same user resolves to
    // the same applicant id (idempotent at the provider).
    const applicantBody = JSON.stringify({ externalUserId: userId });
    const applicantPath = `/resources/applicants?levelName=${encodeURIComponent(this.levelName)}`;
    const applicantRes = await this.signedRequest('POST', applicantPath, applicantBody);
    const applicant = (await safeJson(applicantRes)) as { id?: string } | null;
    const applicantId = applicant?.id;
    if (!applicantId) {
      throw new ServiceUnavailableException('SumSub did not return an applicant id');
    }

    // (2) Mint a short-lived WebSDK access token for the applicant.
    const tokenPath = `/resources/accessTokens?userId=${encodeURIComponent(
      userId,
    )}&levelName=${encodeURIComponent(this.levelName)}&ttlInSecs=3600`;
    const tokenRes = await this.signedRequest('POST', tokenPath, '');
    const tokenJson = (await safeJson(tokenRes)) as { token?: string } | null;
    const accessToken = tokenJson?.token;
    if (!accessToken) {
      throw new ServiceUnavailableException('SumSub did not return an access token');
    }

    return {
      externalId: applicantId,
      redirectUrl: `https://in.sumsub.com/idensic/l/#/${encodeURIComponent(accessToken)}`,
      // SumSub access tokens are valid for `ttlInSecs` seconds; mirror that.
      expiresAt: Date.now() + 60 * 60 * 1000,
    };
  }

  /**
   * Verify the `X-Payload-Digest` HMAC over the raw body and parse the
   * verification result. SumSub's `applicantReviewed` webhook carries:
   *   { applicantId, type, reviewStatus, reviewResult: { reviewAnswer }, createdAt }
   * — we map `reviewAnswer` ∈ `GREEN|RED` to our `approved|rejected`, and any
   * non-terminal event (`pending` / `applicantPending`) to our `pending`.
   */
  async parseWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): Promise<ParseWebhookResult> {
    if (!this.secret) {
      throw new UnauthorizedException('Webhook verification unavailable');
    }
    const provided = pickHeader(headers, 'x-payload-digest');
    if (!provided) {
      throw new UnauthorizedException('Missing X-Payload-Digest header');
    }
    const expected = createHmac('sha256', this.secret).update(rawBody).digest('hex');
    if (!hexSafeEqual(provided, expected)) {
      throw new UnauthorizedException('Invalid X-Payload-Digest signature');
    }

    const body = parseJson(rawBody);
    const applicantId = readString(body, 'applicantId') ?? readString(body, 'externalApplicantId');
    if (!applicantId) {
      throw new UnauthorizedException('SumSub webhook missing applicantId');
    }
    const status = SumsubProvider.mapStatus(body);
    const decidedAt = readDate(body, 'createdAtMs') ?? readDate(body, 'createdAt') ?? new Date();

    return {
      externalId: applicantId,
      status,
      decisionMeta: body,
      decidedAt,
    };
  }

  async getStatus(externalId: string): Promise<GetStatusResult> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('SumSub provider is not configured');
    }
    const path = `/resources/applicants/${encodeURIComponent(externalId)}/one`;
    const res = await this.signedRequest('GET', path, '');
    const body = (await safeJson(res)) as Record<string, unknown> | null;
    return {
      status: body ? SumsubProvider.mapStatus(body) : 'pending',
      decisionMeta: body,
    };
  }

  /** Sign an outbound request and forward it. Throws on non-2xx. */
  private async signedRequest(method: 'GET' | 'POST', path: string, body: string): Promise<Response> {
    const ts = Math.floor(Date.now() / 1000).toString();
    const payload = `${ts}${method}${path}${body}`;
    const sig = createHmac('sha256', this.secret).update(payload).digest('hex');
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'X-App-Token': this.appToken,
        'X-App-Access-Sig': sig,
        'X-App-Access-Ts': ts,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: method === 'POST' && body.length > 0 ? body : undefined,
    });
    if (!res.ok) {
      const text = await safeText(res);
      this.logger.warn(`SumSub ${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
      throw new ServiceUnavailableException(
        `SumSub call failed: ${method} ${path} → ${res.status}`,
      );
    }
    return res;
  }

  /**
   * Map a SumSub webhook / status body to our {@link KycStatus}.
   *
   * SumSub's `reviewResult.reviewAnswer` is the terminal verdict
   * (`GREEN` = approved, `RED` = rejected); `reviewStatus = 'completed'` with
   * no reviewAnswer is treated as `pending` to be conservative.
   */
  static mapStatus(body: Record<string, unknown>): KycStatus {
    const type = readString(body, 'type');
    if (type === 'applicantReviewed') {
      const reviewResult = (body['reviewResult'] ?? {}) as Record<string, unknown>;
      const answer = String(reviewResult['reviewAnswer'] ?? '').toUpperCase();
      if (answer === 'GREEN') return 'approved';
      if (answer === 'RED') return 'rejected';
    }
    if (type === 'applicantExpired') {
      return 'expired';
    }
    return 'pending';
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
