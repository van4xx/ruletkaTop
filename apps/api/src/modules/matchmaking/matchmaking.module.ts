import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AdminModule } from '../admin/admin.module';
import { FriendsModule } from '../friends/friends.module';
import { FriendsService } from '../friends/friends.service';
import { ModerationModule } from '../moderation/moderation.module';
import { BlocksService } from '../moderation/blocks.service';
import { PremiumModule } from '../premium/premium.module';
import { PremiumService } from '../premium/premium.service';
import { PresenceModule } from '../presence/presence.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { ProfilesService } from '../profiles/profiles.service';
import { RealtimeSecurityModule } from '../realtime-security/realtime-security.module';
import { SettingsModule } from '../settings/settings.module';
import { CallService } from './call.service';
import {
  BLOCKS_SERVICE,
  FRIENDS_SERVICE,
  PREMIUM_SERVICE,
  PROFILES_SERVICE,
} from './contracts/external-services';
import { MATCH_RECONCILE_QUEUE, MatchReconcileProcessor } from './match-reconcile.processor';
import { MatchService } from './match.service';
import { MatchmakingGateway } from './matchmaking.gateway';
import { MatchmakingService } from './matchmaking.service';
import { Match, MatchSchema } from './schemas/match.schema';

/**
 * The roulette core: owns the durable `matches` log ({@link MatchService}), the
 * Redis-backed live pool/room registry ({@link MatchmakingService}) and the
 * `/mm` realtime gateway ({@link MatchmakingGateway}) that runs matchmaking and
 * relays WebRTC signaling.
 *
 * Cross-module dependencies are consumed through structural contracts so this
 * module stays decoupled from the concrete identity/social/economy services.
 * The real providers are bound to the contract tokens here via `useExisting`:
 * - {@link PROFILES_SERVICE} → {@link ProfilesService} (peer info, demographics),
 * - {@link BLOCKS_SERVICE} → {@link BlocksService} (block gating),
 * - {@link PREMIUM_SERVICE} → {@link PremiumService} (premium priority),
 * - {@link FRIENDS_SERVICE} → {@link FriendsService} (whoCanCall 'friends' gate).
 *
 * Recipient `whoCanCall` privacy is read straight from the `settings`
 * collection (mirroring how chat reads `whoCanMessage`). {@link SettingsModule}
 * (a leaf, so no cycle) is imported only so the gateway can honour a user's
 * `showOnlineStatus` when relaying presence transitions / subscribe replies —
 * a user who hides it appears offline to everyone watching them.
 *
 * The owning feature modules are imported so those services are in scope; each
 * re-exports its service. `JwtService` (handshake auth) and the shared ioredis
 * client come from the global `CommonModule` / `RedisModule`.
 *
 * Exports {@link MatchService} so moderation/analytics can read the match log.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Match.name, schema: MatchSchema }]),
    ProfilesModule,
    ModerationModule,
    PremiumModule,
    FriendsModule,
    PresenceModule,
    RealtimeSecurityModule,
    SettingsModule,
    // {@link AdminModule} exports the live-flag `SettingsService` so the gateway
    // can honour the runtime MATCHMAKING_ENABLED kill-switch on `mm:join`.
    // AdminModule is a sink (no path back here), so this adds no cycle.
    AdminModule,
    // Background reconciliation sweep for `active` matches left open by an
    // unclean teardown. The BullMQ root connection lives in AppModule; here we
    // just register the named queue this module's processor drains.
    BullModule.registerQueue({ name: MATCH_RECONCILE_QUEUE }),
  ],
  providers: [
    MatchService,
    MatchmakingService,
    CallService,
    MatchmakingGateway,
    MatchReconcileProcessor,
    { provide: PROFILES_SERVICE, useExisting: ProfilesService },
    { provide: BLOCKS_SERVICE, useExisting: BlocksService },
    { provide: PREMIUM_SERVICE, useExisting: PremiumService },
    { provide: FRIENDS_SERVICE, useExisting: FriendsService },
  ],
  exports: [MatchService],
})
export class MatchmakingModule {}
