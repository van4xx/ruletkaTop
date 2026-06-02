import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import {
  type JwtPayload,
  type Message,
  type PaginationQuery,
  paginationQuerySchema,
  type SendMessageDto,
  sendMessageSchema,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import { ChatService, type ConversationPage, type MessagePage } from './chat.service';

/**
 * Authenticated direct-message REST surface (`/conversations`, `/messages`).
 *
 * Reads are scoped to the caller's threads; sending creates a conversation on
 * first contact and is gated by the same block/friendship/privacy rules as the
 * realtime path. Live delivery happens over {@link ChatGateway}; this surface
 * is for history, inbox and HTTP-based sends.
 */
@ApiTags('chat')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('conversations')
  @ApiOperation({ summary: "List the caller's conversations with unread counts" })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Opaque cursor from the previous page',
  })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size (1–100, default 20)' })
  @ApiOkResponse({
    description: 'A page of conversations (most-recently-active first) + next cursor',
  })
  async listConversations(
    @CurrentUser() user: JwtPayload,
    @Query(createZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ): Promise<ConversationPage> {
    return this.chatService.listConversations(user.sub, query);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Cursor-paginated messages of a conversation (newest first)' })
  @ApiParam({ name: 'id', description: 'Conversation id (Mongo ObjectId)' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Last message id from the previous page',
  })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size (1–100, default 20)' })
  @ApiOkResponse({ description: 'A page of messages plus the next cursor' })
  async getMessages(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query(createZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ): Promise<MessagePage> {
    return this.chatService.getMessages(id, user.sub, query);
  }

  @Post('messages')
  @ApiOperation({ summary: 'Send a direct message (creates the conversation if needed)' })
  @ApiCreatedResponse({ description: 'The persisted message' })
  async sendMessage(
    @CurrentUser() user: JwtPayload,
    @Body(createZodValidationPipe(sendMessageSchema)) dto: SendMessageDto,
  ): Promise<Message> {
    const sent = await this.chatService.sendMessage(user.sub, dto);
    return sent.message;
  }
}
