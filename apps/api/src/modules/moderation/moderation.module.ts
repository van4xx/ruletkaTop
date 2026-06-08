import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AdminController } from './admin.controller';
import { AdminEconomyController } from './admin-economy.controller';
import { AdminEconomyService } from './admin-economy.service';
import { AdminService } from './admin.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AppealsController } from './appeals.controller';
import { AppealsService } from './appeals.service';
import { BlocksService } from './blocks.service';
import { FRAME_SCORER, resolveFrameScorer } from './frame-scorer';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { ReportsService } from './reports.service';
import { ReviewService } from './review.service';
import { Appeal, AppealSchema } from './schemas/appeal.schema';
import { Block, BlockSchema } from './schemas/block.schema';
import { ModerationEvent, ModerationEventSchema } from './schemas/moderation-event.schema';
import { Report, ReportSchema } from './schemas/report.schema';

/**
 * Owns the `blocks` and `reports` collections and the authenticated moderation
 * REST surface:
 *  - user routes: `POST /reports`, `/blocks` CRUD;
 *  - moderator routes (role-guarded): `GET /reports`, `POST /reports/:id/resolve`;
 *  - admin routes (role-guarded): `POST /admin/users/:id/{ban,unban}`,
 *    `GET /admin/users`, `GET /admin/users/:id`, `GET /admin/economy/overview`
 *    (moderator+admin); `POST /admin/users/:id/role` (admin-ONLY).
 *
 * Imports {@link UsersModule} so reports/blocks can verify the target account
 * exists (and so {@link AdminService} can flip `isBanned` on the re-exported
 * `User` model) and {@link AuthModule} so the ban flow can revoke all of a
 * user's refresh sessions via {@link AuthService.revokeAllSessions}. The shared
 * Redis client (used to publish forced socket disconnects) comes from the global
 * `RedisModule`.
 *
 * Also owns the AI-MODERATION engine: the `moderation_events` collection (audit
 * log + admin review queue), the pluggable {@link FRAME_SCORER} (no-op default,
 * env-selected provider stub), {@link ModerationService} (escalation policy:
 * warn → kick → ban; zero-tolerance instant ban for `minor`) and
 * {@link ReviewService} (the human review queue). The forced mid-call action is
 * delivered to the realtime gateway via Redis pub/sub (see
 * `MODERATION_ACTION_CHANNEL` in `moderation.constants.ts`) rather than a direct
 * gateway dependency, so this module stays free of a `MatchmakingModule` cycle.
 *
 * Exports {@link BlocksService} so chat / matchmaking / calls can gate
 * interactions via `isBlocked` and prune candidate lists via `listBlockedIds`.
 * On block creation {@link BlocksService} also PUBLISHES to the `block:enforce`
 * Redis channel (see `moderation.constants.ts`); the matchmaking gateway
 * subscribes and force-ends any call in progress between the two users — again
 * via pub/sub so this module stays free of a `MatchmakingModule` cycle.
 * {@link ReportsService} / {@link AdminService} / {@link ModerationService} /
 * {@link ReviewService} are internal and not exported.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Block.name, schema: BlockSchema },
      { name: Report.name, schema: ReportSchema },
      { name: ModerationEvent.name, schema: ModerationEventSchema },
      { name: Appeal.name, schema: AppealSchema },
    ]),
    UsersModule,
    // Breaks the AuthModule → ProfilesModule → ModerationModule → AuthModule cycle.
    forwardRef(() => AuthModule),
    // {@link AdminModule} exports {@link AuditService} so the privileged admin
    // user-management actions (role change, force-logout, verify-email, delete)
    // can append an audit-trail row. No cycle: AdminModule's imports (wallet/
    // premium/notifications/payments) never reach back into ModerationModule.
    AdminModule,
  ],
  controllers: [
    ModerationController,
    AppealsController,
    AdminController,
    AdminUsersController,
    AdminEconomyController,
  ],
  providers: [
    BlocksService,
    ReportsService,
    AppealsService,
    AdminService,
    AdminUsersService,
    AdminEconomyService,
    ModerationService,
    ReviewService,
    // Pluggable server-side frame classifier. Defaults to the no-op (keyless);
    // `FRAME_SCORER=provider` selects the env-gated provider stub.
    {
      provide: FRAME_SCORER,
      useFactory: resolveFrameScorer,
      inject: [ConfigService],
    },
  ],
  exports: [BlocksService, MongooseModule],
})
export class ModerationModule {}
