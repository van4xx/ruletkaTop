import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import { MetricsService } from '../../observability/metrics.service';

/**
 * Express request carrying the raw (unparsed) body buffer.
 *
 * Nest's express body parser exposes the raw bytes as `req.rawBody` when the
 * app is created with `{ rawBody: true }` (the integrator enables this in
 * `main.ts` — see the module-level note / issue). We HMAC the EXACT bytes
 * CloudPayments signed; the parsed `req.body` cannot be re-serialised reliably.
 */
interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/**
 * Verifies CloudPayments webhook authenticity.
 *
 * CloudPayments signs the raw request body with HMAC-SHA256 using the merchant
 * API secret and sends the base64 digest in the `Content-HMAC` header (older
 * integrations / docs also use `X-Content-HMAC`). We recompute the digest over
 * the raw bytes and compare in constant time. On any mismatch / missing header
 * / missing raw body we reject with 401 so the charge is not processed.
 *
 * The secret comes ONLY from `CLOUDPAYMENTS_API_SECRET`; it is never logged.
 *
 * Defence-in-depth — when `CLOUDPAYMENTS_WEBHOOK_IPS` (comma-separated) is set,
 * the request source IP (`req.ip`) must be in that allow-list or we reject with
 * `403` BEFORE doing any HMAC work. The HMAC remains the PRIMARY authenticity
 * control; the allow-list is an optional network-layer filter. It requires
 * `app.set('trust proxy', …)` in `main.ts` so `req.ip` reflects the real client
 * behind a proxy. When the env var is unset the check is skipped (no allow-list
 * configured ⇒ rely on HMAC alone).
 */
@Injectable()
export class CloudPaymentsSignatureGuard implements CanActivate {
  private readonly logger = new Logger(CloudPaymentsSignatureGuard.name);
  private readonly secret: string;
  /** Parsed `CLOUDPAYMENTS_WEBHOOK_IPS` allow-list; empty ⇒ check disabled. */
  private readonly allowedIps: ReadonlySet<string>;

  constructor(
    private readonly config: ConfigService,
    // OBSERVABILITY: bump `ruletka_webhook_signature_failures_total{provider}` on
    // every rejection (forged-webhook / broken-secret alert signal). Optional so
    // the guard still constructs in focused unit tests that wire only the config
    // (and where `MetricsModule` isn't in the injector); when absent the emit is
    // simply skipped — it must NEVER affect the verification verdict.
    @Optional() private readonly metrics?: MetricsService,
  ) {
    this.secret = this.config.get<string>('CLOUDPAYMENTS_API_SECRET', '');
    this.allowedIps = CloudPaymentsSignatureGuard.parseAllowedIps(
      this.config.get<string>('CLOUDPAYMENTS_WEBHOOK_IPS', ''),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    try {
      return this.verify(context);
    } catch (err) {
      // Any rejection (bad IP / missing-or-invalid signature / unconfigured
      // secret) is a webhook-authenticity failure — bump the counter once before
      // re-throwing so the verdict is unchanged. The emit is best-effort.
      try {
        this.metrics?.webhookSignatureFailed('cloudpayments');
      } catch {
        // a metrics blip must never mask the original rejection
      }
      throw err;
    }
  }

  /** The actual verification (throws on any failure); wrapped by canActivate. */
  private verify(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RawBodyRequest>();

    // Network-layer pre-filter (optional): reject sources outside the allow-list.
    if (this.allowedIps.size > 0 && !this.isAllowedSource(request)) {
      this.logger.warn(
        `Rejected CloudPayments webhook from non-allowlisted IP: ${request.ip ?? 'unknown'}`,
      );
      throw new ForbiddenException('Source not allowed');
    }

    if (this.secret.length === 0) {
      // Fail closed: without a configured secret we cannot trust any payload.
      this.logger.error('CLOUDPAYMENTS_API_SECRET is not configured');
      throw new UnauthorizedException('Webhook verification unavailable');
    }

    const provided = this.extractHeader(request);
    if (!provided) {
      throw new UnauthorizedException('Missing Content-HMAC header');
    }

    const rawBody = request.rawBody;
    if (!rawBody || rawBody.length === 0) {
      // Without the raw bytes we cannot verify — reject rather than guess.
      this.logger.error(
        'Raw request body unavailable; enable NestFactory.create(AppModule, { rawBody: true })',
      );
      throw new UnauthorizedException('Webhook verification unavailable');
    }

    const expected = createHmac('sha256', this.secret).update(rawBody).digest('base64');

    if (!CloudPaymentsSignatureGuard.safeEqual(provided, expected)) {
      throw new UnauthorizedException('Invalid Content-HMAC signature');
    }

    return true;
  }

  /**
   * Whether the request's source IP is in the configured allow-list. Compares
   * both the raw `req.ip` and its IPv4-mapped-IPv6 normalisation (`::ffff:x` →
   * `x`) so an allow-list of plain IPv4 addresses still matches when Node
   * reports the mapped form.
   */
  private isAllowedSource(request: Request): boolean {
    const ip = request.ip;
    if (!ip) {
      return false;
    }
    if (this.allowedIps.has(ip)) {
      return true;
    }
    const normalized = CloudPaymentsSignatureGuard.normalizeIp(ip);
    return this.allowedIps.has(normalized);
  }

  /** Strip an IPv4-mapped-IPv6 prefix (`::ffff:1.2.3.4` → `1.2.3.4`). */
  private static normalizeIp(ip: string): string {
    const lower = ip.toLowerCase();
    return lower.startsWith('::ffff:') ? lower.slice('::ffff:'.length) : lower;
  }

  /**
   * Parse a comma-separated allow-list into a normalised, de-duplicated set.
   * Entries that are not IP-shaped (IPv4 or IPv6) are ignored — so a misconfigured
   * non-IP value never silently turns into a one-entry allow-list that would 403
   * every legitimate webhook.
   */
  private static parseAllowedIps(raw: string): ReadonlySet<string> {
    const set = new Set<string>();
    for (const part of raw.split(',')) {
      const trimmed = part.trim();
      if (trimmed.length === 0 || !CloudPaymentsSignatureGuard.looksLikeIp(trimmed)) {
        continue;
      }
      set.add(trimmed);
      set.add(CloudPaymentsSignatureGuard.normalizeIp(trimmed));
    }
    return set;
  }

  /** Loose IPv4 / IPv6 shape check (chars + at least one separator). */
  private static looksLikeIp(value: string): boolean {
    const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/;
    // IPv6: hex groups separated by ':' (allows '::' compression and ::ffff:v4).
    const ipv6 = /^[0-9a-fA-F:]+(\.\d{1,3}){0,3}$/;
    return ipv4.test(value) || (value.includes(':') && ipv6.test(value));
  }

  /** Read the HMAC header (case-insensitive; supports both header spellings). */
  private extractHeader(request: Request): string | null {
    const header = request.headers['content-hmac'] ?? request.headers['x-content-hmac'];
    if (Array.isArray(header)) {
      return header[0] ?? null;
    }
    return typeof header === 'string' && header.length > 0 ? header : null;
  }

  /**
   * Constant-time comparison of two base64 digests. Length-mismatched inputs
   * (or non-base64 garbage) return `false` without throwing or leaking timing.
   */
  static safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'base64');
    const bufB = Buffer.from(b, 'base64');
    if (bufA.length !== bufB.length || bufA.length === 0) {
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }
}
