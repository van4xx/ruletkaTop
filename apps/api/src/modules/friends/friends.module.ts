import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { NotificationsModule } from '../notifications/notifications.module';
import { PremiumModule } from '../premium/premium.module';
import { PresenceModule } from '../presence/presence.module';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';
import { Friendship, FriendshipSchema } from './schemas/friendship.schema';

/**
 * Owns the `friendships` collection and the `/friends` REST surface.
 *
 * Imports {@link PresenceModule} for live online status; minimal friend
 * profiles are read in a single batched `$in` query against the `profiles`
 * collection (by name, via the shared connection), so no `ProfilesModule`
 * dependency is needed. Imports {@link NotificationsModule} so a received /
 * accepted friend request raises a notification (in-app + socket + push) via
 * the exported {@link NotificationsService}. Exports {@link FriendsService} so
 * chat / calls can gate interactions via `areFriends`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Friendship.name, schema: FriendshipSchema }]),
    PresenceModule,
    NotificationsModule,
    // Friends consults {@link PremiumService.getEffectiveTier} to enforce the
    // tier-aware accept cap (Free=100, Lite=500, Pro=∞).
    PremiumModule,
  ],
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [FriendsService, MongooseModule],
})
export class FriendsModule {}
