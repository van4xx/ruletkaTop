import { timingSafeEqual } from 'node:crypto';

import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { METRICS_TOKEN } from './metrics.constants';

/**
 * Optional bearer gate for `GET /metrics`.
 *
 * FAIL-OPEN BY CONFIG: when `METRICS_TOKEN` is blank/undefined (the default),
 * the endpoint is OPEN — the intended deployment scrapes it from a private
 * network / sidecar where the listener itself is not publicly reachable. Set
 * `METRICS_TOKEN` to require `Authorization: Bearer <token>` when the port is
 * exposed more broadly.
 *
 * The comparison is constant-time (`timingSafeEqual`) so a wrong token can't be
 * recovered byte-by-byte via timing. This guard is deliberately NOT the global
 * JWT auth guard — metrics carry no user data and Prometheus presents a static
 * scrape credential, not a JWT.
 */
@Injectable()
export class MetricsTokenGuard implements CanActivate {
  /** Pre-encoded expected token (`undefined` ⇒ endpoint open). */
  private readonly expected?: Buffer;

  constructor(@Optional() @Inject(METRICS_TOKEN) token?: string) {
    const trimmed = token?.trim();
    this.expected = trimmed ? Buffer.from(trimmed, 'utf8') : undefined;
  }

  canActivate(context: ExecutionContext): boolean {
    // No token configured → open endpoint.
    if (!this.expected) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const presented = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length).trim()
      : undefined;

    if (!presented || !this.safeEquals(presented, this.expected)) {
      throw new UnauthorizedException('Invalid metrics token');
    }
    return true;
  }

  /**
   * Constant-time string compare against the expected token buffer. Lengths are
   * compared first (and a same-length dummy compare is run on mismatch) so the
   * branch itself does not leak the expected length.
   */
  private safeEquals(presented: string, expected: Buffer): boolean {
    const presentedBuf = Buffer.from(presented, 'utf8');
    if (presentedBuf.length !== expected.length) {
      // Compare against self to keep the work constant-ish, then fail.
      timingSafeEqual(presentedBuf, presentedBuf);
      return false;
    }
    return timingSafeEqual(presentedBuf, expected);
  }
}
