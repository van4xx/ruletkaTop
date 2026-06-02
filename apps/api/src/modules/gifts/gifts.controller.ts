import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  type Gift,
  type GiftTransaction,
  type JwtPayload,
  type SendGiftDto,
  sendGiftSchema,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import { GiftsService } from './gifts.service';

/**
 * REST surface for gifts under `/gifts`.
 *
 * `GET /gifts` is public (storefront catalogue). `POST /gifts/send` requires a
 * valid access token, charges the authenticated caller and records the gift.
 */
@ApiTags('gifts')
@Controller('gifts')
export class GiftsController {
  constructor(private readonly giftsService: GiftsService) {}

  @Get()
  @ApiOperation({ summary: 'List the gift catalogue (cheapest first)' })
  @ApiOkResponse({ description: 'Gift catalogue' })
  async list(): Promise<Gift[]> {
    return this.giftsService.findAll();
  }

  @Post('send')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Send a gift to another user (debits the sender)',
    description:
      'Atomically debits the caller and records the gift. Returns 422 on ' +
      'insufficient balance, 403 for premium-only gifts sent by a non-premium ' +
      'member, and 404 if the gift does not exist.',
  })
  @ApiCreatedResponse({ description: 'The recorded gift transaction' })
  async send(
    @CurrentUser() user: JwtPayload,
    @Body(createZodValidationPipe(sendGiftSchema)) dto: SendGiftDto,
  ): Promise<GiftTransaction> {
    return this.giftsService.sendGift(user.sub, dto);
  }
}
