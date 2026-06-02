import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  type JwtPayload,
  type TopPlacement,
  type TopPurchaseDto,
  topPurchaseSchema,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import { TopFeed, TopService } from './top.service';

/**
 * REST surface for the "top" feed under `/top`.
 *
 * `GET /top` is public (the two lanes are shown to everyone). `POST
 * /top/purchase` requires a valid access token and charges the caller.
 */
@ApiTags('top')
@Controller('top')
export class TopController {
  constructor(private readonly topService: TopService) {}

  @Get()
  @ApiOperation({ summary: 'Get the two active top-feed lanes (priority desc)' })
  @ApiOkResponse({ description: 'Active placements grouped into `left` / `right`' })
  async getFeed(): Promise<TopFeed> {
    return this.topService.getActiveFeed();
  }

  @Post('purchase')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Buy a top-feed placement (debits the buyer)',
    description:
      'Atomically debits the caller and creates a placement active for ' +
      '`durationHours`. Returns 422 on insufficient balance. More coins ⇒ ' +
      'higher priority within the lane.',
  })
  @ApiCreatedResponse({ description: 'The created placement' })
  async purchase(
    @CurrentUser() user: JwtPayload,
    @Body(createZodValidationPipe(topPurchaseSchema)) dto: TopPurchaseDto,
  ): Promise<TopPlacement> {
    return this.topService.purchase(user.sub, dto);
  }
}
