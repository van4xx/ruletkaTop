import { Module } from '@nestjs/common';

import { WsAuthService } from './ws-auth.service';
import { WsRateLimiterService } from './ws-rate-limiter.service';

/**
 * Cross-cutting WebSocket security building blocks shared by the realtime
 * gateways ({@link MatchmakingGateway}, {@link ChatGateway}):
 * - {@link WsRateLimiterService}: per-user Redis token buckets + concurrent
 *   socket cap;
 * - {@link WsAuthService}: HS256-pinned + Zod-validated handshake verification,
 *   on-connect ban re-check, and the `user:disconnect` pub/sub that force-drops
 *   a banned user's live sockets.
 *
 * Depends only on globally-provided infrastructure (`JwtService` from the global
 * `CommonModule`, the shared ioredis client from `RedisModule`, and the root
 * Mongoose connection), so it has no imports of its own; feature gateway modules
 * import THIS module to consume the two services.
 */
@Module({
  providers: [WsRateLimiterService, WsAuthService],
  exports: [WsRateLimiterService, WsAuthService],
})
export class RealtimeSecurityModule {}
