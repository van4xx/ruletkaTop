import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { FriendsModule } from '../friends/friends.module';
import { ModerationModule } from '../moderation/moderation.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeSecurityModule } from '../realtime-security/realtime-security.module';
import { ActiveConversationService } from './active-conversation.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { Conversation, ConversationSchema } from './schemas/conversation.schema';
import { Message, MessageSchema } from './schemas/message.schema';

/**
 * Owns the `conversations` and `messages` collections, the `/conversations` +
 * `/messages` REST surface and the `/chat` realtime gateway.
 *
 * Imports {@link FriendsModule} ({@link FriendsService.areFriends}) and
 * {@link ModerationModule} ({@link BlocksService.isBlocked}) to gate delivery;
 * recipient privacy is read from the `settings` collection directly. `JwtService`
 * (handshake auth) is provided app-wide by the global `CommonModule`. Imports
 * {@link NotificationsModule} ({@link NotificationsService}) so a message sent to
 * a recipient who is NOT currently in that conversation raises an in-app `message`
 * notification (best-effort). {@link ActiveConversationService} is a local
 * provider holding the Redis-backed "currently-focused conversation" markers that
 * decide whether that notification fires.
 *
 * {@link ChatService} is exported so gifting can post `gift`-type messages.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
    ]),
    FriendsModule,
    ModerationModule,
    RealtimeSecurityModule,
    NotificationsModule,
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, ActiveConversationService],
  exports: [ChatService],
})
export class ChatModule {}
