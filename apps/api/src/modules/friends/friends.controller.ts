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
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import {
  type FriendRequestDto,
  friendRequestSchema,
  type FriendRequestsResponse,
  type Friendship,
  type JwtPayload,
  type PaginationQuery,
  paginationQuerySchema,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import { type FriendPage, FriendsService } from './friends.service';

/**
 * Authenticated friendships surface under `/friends`. Every route acts on
 * behalf of the caller (`@CurrentUser().sub`): you may request anyone, accept
 * requests addressed to you, list your own accepted friends, and remove a
 * friendship you participate in.
 */
@ApiTags('friends')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('friends')
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Get()
  @ApiOperation({ summary: "List the caller's accepted friends with online status" })
  @ApiQuery({ name: 'cursor', required: false, description: 'Opaque cursor from the previous page' })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size (1–100, default 20)' })
  @ApiOkResponse({ description: 'A page of friend summaries (minimal profile + presence) + next cursor' })
  async listFriends(
    @CurrentUser() user: JwtPayload,
    @Query(createZodValidationPipe(paginationQuerySchema)) query: PaginationQuery,
  ): Promise<FriendPage> {
    return this.friendsService.listFriends(user.sub, query);
  }

  @Get('requests')
  @ApiOperation({
    summary: "List the caller's pending friend requests, split into incoming/outgoing",
  })
  @ApiOkResponse({
    description:
      'Pending requests split by direction (incoming = you can accept/decline; outgoing = awaiting), newest first',
  })
  async listRequests(@CurrentUser() user: JwtPayload): Promise<FriendRequestsResponse> {
    return this.friendsService.listRequests(user.sub);
  }

  @Post('request')
  @ApiOperation({ summary: 'Send a friend request to another user' })
  @ApiCreatedResponse({ description: 'The created (pending) friendship' })
  async sendRequest(
    @CurrentUser() user: JwtPayload,
    @Body(createZodValidationPipe(friendRequestSchema)) dto: FriendRequestDto,
  ): Promise<Friendship> {
    return this.friendsService.sendRequest(user.sub, dto.recipientId);
  }

  @Post(':id/accept')
  @ApiOperation({ summary: 'Accept a pending friend request addressed to you' })
  @ApiParam({ name: 'id', description: 'Friendship id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'The accepted friendship' })
  async acceptRequest(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<Friendship> {
    return this.friendsService.acceptRequest(id, user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a friendship or decline a request' })
  @ApiParam({ name: 'id', description: 'Friendship id (Mongo ObjectId)' })
  @ApiNoContentResponse({ description: 'Friendship removed' })
  async removeFriendship(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.friendsService.removeFriendship(id, user.sub);
  }
}
