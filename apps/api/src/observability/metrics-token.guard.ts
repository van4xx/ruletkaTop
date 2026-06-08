import { timingSafeEqual } from 'node:crypto';

import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import { METRICS_TOKEN } from './metrics.constants';

/**
 * Optional bearer gate for `GET /metrics`.
 *
 * DEV/TEST — FAIL-OPEN BY CONFIG: when `METRICS_TOKEN` is blank/undefined, the
 * endpoint is OPEN, so a local Prometheus / CI scrape works with no token.
 *
 * PRODUCTION — FAIL-FAST: a blank `METRICS_TOKEN` is REJECTED at construction
 * (which runs during bootstrap, aborting `app.listen()`). The metrics route is
 * reachable through the public nginx edge (`api.ruletka.top/api/metrics`), so a
 * fail-open blank token there would publish queue depth, socket counts and the
 * default `process_*` series to anyone — and leaking internal topology is an
 * info-disclosure foothold. Refusing to boot closes that fail-open; the nginx
 * config ALSO `deny all`s the `/metrics` location as defence-in-depth.
 *
 * The comparison is constant-time (`timingSafeEqual`) so a wrong token can't be
 * recovered byte-by-byte via timing. This guard is deliberately NOT the global
 * JWT auth guard — metrics carry no user data and Prometheus presents a static
 * scrape credential, not a JWT.
 */
@Injectable()
export class MetricsTokenGuard implements CanActivate {
  /** Pre-encoded expected token (`undefined` ⇒ endpoint open, dev/test only). */
  private readonly expected?: Buffer;

  constructor(
    @Optional() @Inject(METRICS_TOKEN) token?: string,
    @Optional() config?: ConfigService,
  ) {
    const trimmed = token?.trim();

    // PRODUCTION FAIL-FAST: an unset/blank METRICS_TOKEN leaves /metrics open at
    // the public edge. Abort bootstrap rather than serve internal telemetry
    // unauthenticated. Gated on NODE_ENV=production so dev/test/CI (which scrape
    // without a token) are never blocked — matching common/config-validation.ts.
    const isProd = config?.get<string>('NODE_ENV') === 'production';
    if (isProd && !trimmed) {
      throw new Error(
        'FATAL: METRICS_TOKEN is required in production — GET /metrics is reachable ' +
          'through the public nginx edge and would otherwise expose internal telemetry ' +
          'unauthenticated. Set a strong METRICS_TOKEN (e.g. `openssl rand -base64 32`). ' +
          'Refusing to boot.',
      );
    }

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
