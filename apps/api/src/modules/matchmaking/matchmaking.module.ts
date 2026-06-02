import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { FriendsModule } from '../friends/friends.module';
import { FriendsService } from '../friends/friends.service';
import { ModerationModule } from '../moderation/moderation.module';
import { BlocksService } from '../moderation/blocks.service';
import { PremiumModule } from '../premium/premium.module';
import { PremiumService } from '../premium/premium.service';
import { ProfilesModule } from '../profiles/profiles.module';
import { ProfilesService } from '../profiles/profiles.service';
import { RealtimeSecurityModule } from '../realtime-security/realtime-security.module';
import {
  BLOCKS_SERVICE,
  FRIENDS_SERVICE,
  PREMIUM_SERVICE,
  PROFILES_SERVICE,
} from './contracts/external-services';
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
 * collection (mirroring how chat reads `whoCanMessage`), so no settings module
 * dependency is taken.
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
    RealtimeSecurityModule,
  ],
  providers: [
    MatchService,
    MatchmakingService,
    MatchmakingGateway,
    { provide: PROFILES_SERVICE, useExisting: ProfilesService },
    { provide: BLOCKS_SERVICE, useExisting: BlocksService },
    { provide: PREMIUM_SERVICE, useExisting: PremiumService },
    { provide: FRIENDS_SERVICE, useExisting: FriendsService },
  ],
  exports: [MatchService],
})
export class MatchmakingModule {}
