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

import { MetricsService } from '../../../observability/metrics.service';
import { verifyTbankToken, type TbankPayload } from './tbank-signature';

/**
 * Verifies T-Bank webhook authenticity by recomputing the `Token` field over
 * the request body and comparing in constant time. The algorithm is the SAME
 * one used to SIGN our outbound requests (see {@link verifyTbankToken}): drop
 * `Token` and any nested object/array (Receipt / DATA), add `Password`, sort
 * by key, concat values, SHA-256.
 *
 * The body is parsed JSON (T-Bank notifications use `application/json`), so
 * `req.body` already has the right shape — no rawBody dance required.
 *
 * Fail-closed:
 *   - missing/empty TBANK_PASSWORD → 401 (cannot trust any payload);
 *   - allow-list set and request IP not in it → 403 BEFORE Token work;
 *   - mismatched / missing Token → 401.
 *
 * The password is read from config ONCE at construction and never logged.
 */
@Injectable()
export class TbankSignatureGuard implements CanActivate {
  private readonly logger = new Logger(TbankSignatureGuard.name);
  private readonly password: string;
  /** Parsed TBANK_WEBHOOK_IPS allow-list; empty ⇒ check disabled (rely on Token). */
  private readonly allowedIps: ReadonlySet<string>;

  constructor(
    private readonly config: ConfigService,
    // OBSERVABILITY: bump the forged-webhook counter on every rejection. Optional
    // so focused unit tests can wire only the config; absent ⇒ skip silently.
    @Optional() private readonly metrics?: MetricsService,
  ) {
    this.password = this.config.get<string>('TBANK_PASSWORD', '').trim();
    this.allowedIps = TbankSignatureGuard.parseAllowedIps(
      this.config.get<string>('TBANK_WEBHOOK_IPS', ''),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    try {
      return this.verify(context);
    } catch (err) {
      // Best-effort: bump the failure counter once before re-throwing so the
      // verdict is unchanged. A metrics blip must never mask the rejection.
      try {
        this.metrics?.webhookSignatureFailed('tbank');
      } catch {
        // ignore
      }
      throw err;
    }
  }

  /** Actual verification; wrapped by canActivate. */
  private verify(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (this.allowedIps.size > 0 && !this.isAllowedSource(request)) {
      this.logger.warn(
        `Rejected T-Bank webhook from non-allowlisted IP: ${request.ip ?? 'unknown'}`,
      );
      throw new ForbiddenException('Source not allowed');
    }

    if (this.password.length === 0) {
      this.logger.error('TBANK_PASSWORD is not configured');
      throw new UnauthorizedException('Webhook verification unavailable');
    }

    const body = request.body as TbankPayload | undefined;
    if (!body || typeof body !== 'object') {
      throw new UnauthorizedException('Missing webhook body');
    }
    if (typeof body.Token !== 'string' || body.Token.length === 0) {
      throw new UnauthorizedException('Missing Token field');
    }

    if (!verifyTbankToken(body, this.password)) {
      throw new UnauthorizedException('Invalid Token signature');
    }

    return true;
  }

  /** Whether the request's source IP is in the configured allow-list. */
  private isAllowedSource(request: Request): boolean {
    const ip = request.ip;
    if (!ip) {
      return false;
    }
    if (this.allowedIps.has(ip)) {
      return true;
    }
    const normalised = TbankSignatureGuard.normaliseIp(ip);
    return this.allowedIps.has(normalised);
  }

  /** Strip an IPv4-mapped-IPv6 prefix (`::ffff:1.2.3.4` → `1.2.3.4`). */
  private static normaliseIp(ip: string): string {
    const lower = ip.toLowerCase();
    return lower.startsWith('::ffff:') ? lower.slice('::ffff:'.length) : lower;
  }

  /** Parse comma-separated allow-list into a normalised, de-duplicated set. */
  private static parseAllowedIps(raw: string): ReadonlySet<string> {
    const set = new Set<string>();
    for (const part of raw.split(',')) {
      const trimmed = part.trim();
      if (trimmed.length === 0 || !TbankSignatureGuard.looksLikeIp(trimmed)) {
        continue;
      }
      set.add(trimmed);
      set.add(TbankSignatureGuard.normaliseIp(trimmed));
    }
    return set;
  }

  /** Loose IPv4 / IPv6 shape check. */
  private static looksLikeIp(value: string): boolean {
    const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/;
    const ipv6 = /^[0-9a-fA-F:]+(\.\d{1,3}){0,3}$/;
    return ipv4.test(value) || (value.includes(':') && ipv6.test(value));
  }
}
