import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import type {
  AppNotification,
  DevicePushTokenDto,
  PushSubscriptionDto,
} from '@ruletka/shared-types';

import {
  DeviceToken,
  DeviceTokenDocument,
} from './schemas/device-token.schema';
import {
  PushSubscription,
  PushSubscriptionDocument,
} from './schemas/push-subscription.schema';
import {
  MOBILE_PUSH_PROVIDER,
  type MobilePushProvider,
  WEB_PUSH_PROVIDER,
  type WebPushProvider,
} from './push/push.types';

/**
 * Owns push-subscription STORAGE (browser Web Push + mobile device tokens) and
 * the best-effort FAN-OUT of a notification to a user's registered targets.
 *
 * The actual transport is delegated to two pluggable providers
 * ({@link WebPushProvider}, {@link MobilePushProvider}) that default to keyless
 * no-ops, so the API runs without VAPID/Firebase secrets — only the external
 * push leg is skipped; in-app + socket delivery (in {@link NotificationsService})
 * is unaffected.
 *
 * Dead targets are self-healing: when a provider reports a subscription/token is
 * `gone` (push service returned 404/410), the row is deleted so we stop sending
 * to it.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @InjectModel(PushSubscription.name)
    private readonly subModel: Model<PushSubscriptionDocument>,
    @InjectModel(DeviceToken.name)
    private readonly tokenModel: Model<DeviceTokenDocument>,
    @Inject(WEB_PUSH_PROVIDER) private readonly webPush: WebPushProvider,
    @Inject(MOBILE_PUSH_PROVIDER) private readonly mobilePush: MobilePushProvider,
  ) {}

  // ── Subscription storage ───────────────────────────────────────────────────

  /**
   * Register (or refresh) a browser Web Push subscription for `userId`. Keyed by
   * the unique `endpoint`, so re-subscribing the same browser upserts. We also
   * (re)bind the `userId` in case the same browser is now a different account.
   */
  async subscribeWeb(userId: string, dto: PushSubscriptionDto): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      return;
    }
    await this.subModel
      .updateOne(
        { endpoint: dto.endpoint },
        {
          $set: {
            userId: new Types.ObjectId(userId),
            endpoint: dto.endpoint,
            expirationTime: dto.expirationTime ?? null,
            p256dh: dto.keys.p256dh,
            auth: dto.keys.auth,
          },
        },
        { upsert: true },
      )
      .exec();
  }

  /** Remove a browser subscription by endpoint (unsubscribe). Idempotent. */
  async unsubscribeWeb(userId: string, endpoint: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      return;
    }
    await this.subModel
      .deleteOne({ endpoint, userId: new Types.ObjectId(userId) })
      .exec();
  }

  /**
   * Register (or refresh) a mobile device push token for `userId`. Keyed by the
   * unique `token`, so re-registering the same device upserts and re-binds the
   * owning account.
   */
  async registerDeviceToken(userId: string, dto: DevicePushTokenDto): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      return;
    }
    await this.tokenModel
      .updateOne(
        { token: dto.token },
        {
          $set: {
            userId: new Types.ObjectId(userId),
            token: dto.token,
            platform: dto.platform,
          },
        },
        { upsert: true },
      )
      .exec();
  }

  /** Remove a mobile device token (logout / unsubscribe). Idempotent. */
  async removeDeviceToken(userId: string, token: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      return;
    }
    await this.tokenModel
      .deleteOne({ token, userId: new Types.ObjectId(userId) })
      .exec();
  }

  // ── Fan-out ──────────────────────────────────────────────────────────────────

  /**
   * Best-effort push of one notification to ALL of a user's registered targets
   * (browser subscriptions + mobile tokens). Never throws — a push failure must
   * not break the originating action (sending a gift, accepting a request, …).
   *
   * Short-circuits the DB reads when BOTH providers are disabled (keyless dev),
   * so the common no-secret path costs nothing.
   */
  async fanOut(userId: string, notification: AppNotification): Promise<void> {
    if (!this.webPush.enabled && !this.mobilePush.enabled) {
      return;
    }
    if (!Types.ObjectId.isValid(userId)) {
      return;
    }
    const owner = new Types.ObjectId(userId);
    try {
      await Promise.all([
        this.fanOutWeb(owner, notification),
        this.fanOutMobile(owner, notification),
      ]);
    } catch (err) {
      this.logger.debug(`push fan-out failed for ${userId}: ${asMessage(err)}`);
    }
  }

  /** Send to every browser subscription, pruning any the service reports gone. */
  private async fanOutWeb(owner: Types.ObjectId, notification: AppNotification): Promise<void> {
    if (!this.webPush.enabled) {
      return;
    }
    const subs = await this.subModel.find({ userId: owner }).exec();
    const dead: string[] = [];
    await Promise.all(
      subs.map(async (sub) => {
        const result = await this.webPush.send(
          {
            endpoint: sub.endpoint,
            expirationTime: sub.expirationTime,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          notification,
        );
        if (result.gone) {
          dead.push(sub.endpoint);
        }
      }),
    );
    if (dead.length > 0) {
      await this.subModel.deleteMany({ endpoint: { $in: dead } }).exec();
      this.logger.debug(`pruned ${dead.length} dead web push subscription(s)`);
    }
  }

  /** Send to every device token, pruning any the service reports gone. */
  private async fanOutMobile(owner: Types.ObjectId, notification: AppNotification): Promise<void> {
    if (!this.mobilePush.enabled) {
      return;
    }
    const tokens = await this.tokenModel.find({ userId: owner }).exec();
    const dead: string[] = [];
    await Promise.all(
      tokens.map(async (row) => {
        const result = await this.mobilePush.send(row.token, notification);
        if (result.gone) {
          dead.push(row.token);
        }
      }),
    );
    if (dead.length > 0) {
      await this.tokenModel.deleteMany({ token: { $in: dead } }).exec();
      this.logger.debug(`pruned ${dead.length} dead device token(s)`);
    }
  }
}

/** Narrows an unknown thrown value to a printable message. */
function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
