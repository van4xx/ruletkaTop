import { Module } from '@nestjs/common';

import { TurnController } from './turn.controller';
import { TurnService } from './turn.service';

/**
 * Exposes the `/turn` REST surface that mints ephemeral coturn ICE credentials
 * for WebRTC ({@link TurnService}). Stateless — no Mongo collection, no Redis;
 * everything is derived per-request from `TURN_*` env config and the shared
 * `TURN_STATIC_AUTH_SECRET`. JWT verification comes from the global
 * `CommonModule`.
 *
 * Exports {@link TurnService} so the realtime layer could embed ICE config in a
 * future signaling handshake if desired.
 */
@Module({
  controllers: [TurnController],
  providers: [TurnService],
  exports: [TurnService],
})
export class TurnModule {}
