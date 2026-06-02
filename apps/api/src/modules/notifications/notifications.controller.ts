import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import {
  type DevicePushTokenDto,
  devicePushTokenSchema,
  type JwtPayload,
  type ListNotificationsQuery,
  listNotificationsQuerySchema,
  type PushSubscriptionDto,
  pushSubscriptionSchema,
  type UnreadCount,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import {
  type NotificationPage,
  NotificationsService,
} from './notifications.service';
import { PushService } from './push.service';

/**
 * Authenticated notifications surface under `/notifications`. Every route acts
 * on behalf of the caller (`@CurrentUser().sub`): list your own notifications,
 * read the unread badge count, mark items read, and register/unregister push
 * transports (browser Web Push + mobile device tokens).
 */
@ApiTags('notifications')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly pushService: PushService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List the caller's notifications, newest first" })
  @ApiQuery({ name: 'cursor', required: false, description: 'Opaque cursor (notification id) from the previous page' })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size (1–50, default 20)' })
  @ApiQuery({ name: 'unreadOnly', required: false, description: 'When true, only unread items' })
  @ApiOkResponse({ description: 'A page of notifications + next cursor' })
  async list(
    @CurrentUser() user: JwtPayload,
    @Query(createZodValidationPipe(listNotificationsQuerySchema))
    query: ListNotificationsQuery,
  ): Promise<NotificationPage> {
    return this.notificationsService.list(user.sub, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: "The caller's unread notification count (header badge)" })
  @ApiOkResponse({ description: 'The unread count' })
  async unreadCount(@CurrentUser() user: JwtPayload): Promise<UnreadCount> {
    const count = await this.notificationsService.unreadCount(user.sub);
    return { count };
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark a single notification as read' })
  @ApiParam({ name: 'id', description: 'Notification id (Mongo ObjectId)' })
  @ApiNoContentResponse({ description: 'Marked read (idempotent)' })
  async markRead(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.notificationsService.markRead(id, user.sub);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Mark all of the caller's notifications as read" })
  @ApiNoContentResponse({ description: 'All marked read' })
  async markAllRead(@CurrentUser() user: JwtPayload): Promise<void> {
    await this.notificationsService.markAllRead(user.sub);
  }

  // ── Push transports ──────────────────────────────────────────────────────────

  @Post('push/subscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Register a browser Web Push subscription for the caller' })
  @ApiNoContentResponse({ description: 'Subscription stored (upsert by endpoint)' })
  async subscribeWeb(
    @CurrentUser() user: JwtPayload,
    @Body(createZodValidationPipe(pushSubscriptionSchema)) dto: PushSubscriptionDto,
  ): Promise<void> {
    await this.pushService.subscribeWeb(user.sub, dto);
  }

  @Delete('push/subscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a browser Web Push subscription (unsubscribe)' })
  @ApiNoContentResponse({ description: 'Subscription removed (idempotent)' })
  async unsubscribeWeb(
    @CurrentUser() user: JwtPayload,
    @Body(createZodValidationPipe(pushSubscriptionSchema)) dto: PushSubscriptionDto,
  ): Promise<void> {
    await this.pushService.unsubscribeWeb(user.sub, dto.endpoint);
  }

  @Post('push/device-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Register a mobile push token (FCM / APNs) for the caller' })
  @ApiNoContentResponse({ description: 'Token stored (upsert by token)' })
  async registerDeviceToken(
    @CurrentUser() user: JwtPayload,
    @Body(createZodValidationPipe(devicePushTokenSchema)) dto: DevicePushTokenDto,
  ): Promise<void> {
    await this.pushService.registerDeviceToken(user.sub, dto);
  }

  @Delete('push/device-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a mobile push token (logout / unsubscribe)' })
  @ApiNoContentResponse({ description: 'Token removed (idempotent)' })
  async removeDeviceToken(
    @CurrentUser() user: JwtPayload,
    @Body(createZodValidationPipe(devicePushTokenSchema)) dto: DevicePushTokenDto,
  ): Promise<void> {
    await this.pushService.removeDeviceToken(user.sub, dto.token);
  }
}
