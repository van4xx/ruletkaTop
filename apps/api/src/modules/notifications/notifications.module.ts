import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { MOBILE_PUSH_PROVIDER, WEB_PUSH_PROVIDER } from './push/push.types';
import { resolveMobilePushProvider } from './push/mobile-push.provider';
import { resolveWebPushProvider } from './push/web-push.provider';
import { DeviceToken, DeviceTokenSchema } from './schemas/device-token.schema';
import { Notification, NotificationSchema } from './schemas/notification.schema';
import { PushSubscription, PushSubscriptionSchema } from './schemas/push-subscription.schema';

/**
 * Owns the `notifications` collection (the in-app center) plus push-subscription
 * storage (`push_subscriptions` for browser Web Push, `device_tokens` for
 * mobile FCM/APNs) and the authenticated `/notifications` REST surface.
 *
 * {@link NotificationsService} is EXPORTED so producing modules — friends (a
 * request received / accepted), gifts (a gift received), matchmaking (a call
 * invite) — inject it and call `create(...)` to persist + deliver a
 * notification. Delivery is decoupled from the realtime gateway via the
 * `notif:new` Redis channel (see `notifications.constants.ts`), mirroring the
 * `moderation:action` pattern, so this module forms no cycle with
 * {@link MatchmakingModule}.
 *
 * The two push transports are pluggable providers bound to keyless NO-OP
 * defaults: {@link WEB_PUSH_PROVIDER} becomes a real `web-push`/VAPID sender only
 * when `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` are set; {@link MOBILE_PUSH_PROVIDER}
 * stays a no-op until Firebase creds are wired. So the app runs without secrets
 * (in-app + socket delivery still work). The shared ioredis client comes from
 * the global `RedisModule`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: PushSubscription.name, schema: PushSubscriptionSchema },
      { name: DeviceToken.name, schema: DeviceTokenSchema },
    ]),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    PushService,
    {
      provide: WEB_PUSH_PROVIDER,
      useFactory: resolveWebPushProvider,
      inject: [ConfigService],
    },
    {
      provide: MOBILE_PUSH_PROVIDER,
      useFactory: resolveMobilePushProvider,
      inject: [ConfigService],
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
