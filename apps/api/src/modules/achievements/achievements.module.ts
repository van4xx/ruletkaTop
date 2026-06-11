import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { PremiumModule } from '../premium/premium.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { AchievementsController } from './achievements.controller';
import { AchievementsService } from './achievements.service';
import { UserAchievement, UserAchievementSchema } from './schemas/user-achievement.schema';

/**
 * Owns the `userachievements` collection + the `/achievements` REST surface.
 *
 * Imports {@link PremiumModule} (read-only `isPremium` lookup for the
 * `premium-subscriber` badge) and {@link ProfilesModule} (`whoCanViewProfile`
 * privacy gate on the public unlock list — reused so the surface respects the
 * exact same rules as `GET /profiles/:id`). `JwtService` is provided app-wide
 * by `CommonModule`, so the controller can OPTIONALLY decode the bearer to
 * identify the viewer without re-importing it.
 *
 * Exports {@link AchievementsService} so cross-module callers (wallet,
 * matchmaking, chat, friends, daily-bonus, leaderboard) can fire
 * `checkAndUnlock(userId, eventKey, payload)` without re-importing this
 * module's schema. NO cycles: this module imports ProfilesModule (a leaf-ish
 * module) and PremiumModule (a leaf module); nothing under either imports
 * this module.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: UserAchievement.name, schema: UserAchievementSchema }]),
    ProfilesModule,
    PremiumModule,
  ],
  controllers: [AchievementsController],
  providers: [AchievementsService],
  exports: [AchievementsService, MongooseModule],
})
export class AchievementsModule {}
