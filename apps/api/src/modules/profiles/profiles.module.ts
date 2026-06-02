import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ModerationModule } from '../moderation/moderation.module';
import { SettingsModule } from '../settings/settings.module';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { Profile, ProfileSchema } from './schemas/profile.schema';

/**
 * Owns the `profiles` collection and the public-profile REST surface.
 *
 * Exports {@link ProfilesService} (`getPublicProfile`, `incrementViews`,
 * `getAgeAndGender`, plus registration helpers) for matchmaking/social/auth.
 * `JwtService` is provided app-wide by the global `CommonModule`, so the
 * controller can optionally decode bearer tokens without re-importing it.
 *
 * Imports {@link SettingsModule} (read a target's `whoCanViewProfile` to gate
 * profile views) and {@link ModerationModule} (`BlocksService` — exclude
 * blocked users from search and hide blocked profiles). Both are LEAF modules
 * (they import no feature module), so neither introduces a dependency cycle
 * even though `ProfilesModule` is itself imported by auth/friends/matchmaking.
 * The `friendships` collection (for friends-only visibility) is read directly
 * by name to avoid the cycle with `FriendsModule`, which imports this module.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Profile.name, schema: ProfileSchema }]),
    SettingsModule,
    ModerationModule,
  ],
  controllers: [ProfilesController],
  providers: [ProfilesService],
  exports: [ProfilesService, MongooseModule],
})
export class ProfilesModule {}
