import { Module } from '@nestjs/common';

import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';

/**
 * Redis-backed presence (online/away/in_call/offline) with heartbeat TTLs and
 * pub/sub transition events.
 *
 * Exports {@link PresenceService} so the friends and chat modules can read
 * status and so gateways can drive heartbeats and relay transitions. Relies on
 * the global {@link RedisModule} for the shared ioredis client (no Mongo here).
 */
@Module({
  controllers: [PresenceController],
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}
