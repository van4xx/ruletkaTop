import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Cloudflare Turnstile siteverify endpoint.
 * @see https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** How long we wait on the siteverify call before giving up. */
const VERIFY_TIMEOUT_MS = 5_000;

/** Shape of the JSON Turnstile returns (only the fields we read). */
interface TurnstileVerifyResponse {
  success: boolean;
  'error-codes'?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
}

/**
 * Verifies human-challenge (CAPTCHA) tokens.
 *
 * Provider is Cloudflare Turnstile, kept behind this small interface with a
 * WORKING NO-OP DEFAULT: when `TURNSTILE_SECRET` is unset the service is
 * "disabled" and {@link verify} resolves to `true` for ANY (or absent) token,
 * so the app compiles and runs in development with no Cloudflare account. Set
 * `TURNSTILE_SECRET` (server secret key) to switch verification on. The web
 * client uses the matching `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
 *
 * The contract field `registerSchema.captchaToken` is OPTIONAL; the auth flow
 * only enforces a token when this service is {@link isEnabled enabled}.
 */
@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);

  /** Server-side secret key; empty/undefined → verification disabled (no-op). */
  private readonly secret: string;

  constructor(private readonly configService: ConfigService) {
    this.secret = (this.configService.get<string>('TURNSTILE_SECRET') ?? '').trim();
    if (!this.isEnabled()) {
      this.logger.log(
        'TURNSTILE_SECRET not set — CAPTCHA verification DISABLED (dev no-op; all tokens accepted).',
      );
    }
  }

  /** Whether real CAPTCHA verification is configured (a secret is present). */
  isEnabled(): boolean {
    return this.secret.length > 0;
  }

  /**
   * Verify a Turnstile token against Cloudflare's siteverify endpoint.
   *
   * - DISABLED (no secret) → always resolves `true` (dev no-op), regardless of
   *   whether a token was supplied.
   * - ENABLED but token missing/blank → `false` (caller rejects with 400).
   * - ENABLED → POST `secret`+`response`(+`remoteip`) and return the boolean
   *   `success` from the JSON body. A network error / non-2xx / timeout fails
   *   CLOSED (`false`) so a verification outage cannot be used to bypass the
   *   challenge.
   *
   * `remoteip` is optional in the Turnstile API; we forward the caller's IP when
   * available to strengthen the signal.
   */
  async verify(token: string | undefined | null, remoteIp?: string | null): Promise<boolean> {
    if (!this.isEnabled()) {
      return true;
    }
    if (typeof token !== 'string' || token.length === 0) {
      return false;
    }

    const body = new URLSearchParams();
    body.set('secret', this.secret);
    body.set('response', token);
    if (remoteIp) {
      body.set('remoteip', remoteIp);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
    try {
      const res = await fetch(TURNSTILE_VERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(`Turnstile siteverify returned HTTP ${res.status}`);
        return false;
      }
      const json = (await res.json()) as TurnstileVerifyResponse;
      if (!json.success) {
        const codes = json['error-codes']?.join(', ') ?? 'unknown';
        this.logger.warn(`Turnstile verification failed: ${codes}`);
      }
      return json.success === true;
    } catch (err) {
      // Network error / abort / malformed JSON → fail closed.
      this.logger.warn(
        `Turnstile verification error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
