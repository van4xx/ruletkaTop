import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * Global rate-limit guard that tracks the REAL client IP behind a proxy.
 *
 * Express populates `req.ips` (left-to-right `X-Forwarded-For` chain) only when
 * `app.set('trust proxy', …)` is enabled — the integrator does this in
 * `main.ts`. The leftmost entry is the originating client; we fall back to
 * `req.ip` for direct (non-proxied) connections. Tracking the forwarded address
 * stops every request from collapsing onto the proxy's single IP (which would
 * either rate-limit all users together or let them all bypass the limit).
 *
 * Register as the global throttler guard:
 * `{ provide: APP_GUARD, useClass: ThrottlerBehindProxyGuard }`.
 */
@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  protected override getTracker(req: Request): Promise<string> {
    const forwarded = Array.isArray(req.ips) && req.ips.length > 0 ? req.ips[0] : undefined;
    return Promise.resolve(forwarded ?? req.ip ?? 'unknown');
  }
}
