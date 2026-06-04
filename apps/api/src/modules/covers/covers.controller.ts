import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  type CoverInventory,
  type JwtPayload,
  type ProfileCover,
  type PublicProfile,
  type PurchaseCoverDto,
  purchaseCoverSchema,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import { CoversService } from './covers.service';

/**
 * REST surface for profile-cover cosmetics under `/covers`.
 *
 * `GET /covers` is public (the storefront catalogue). The remaining routes
 * require a valid access token and only ever act on the AUTHENTICATED caller's
 * own profile (never a target user id) — purchasing debits the caller's wallet
 * and `set-active` only switches a cover the caller owns.
 */
@ApiTags('covers')
@Controller('covers')
export class CoversController {
  constructor(private readonly coversService: CoversService) {}

  @Get()
  @ApiOperation({ summary: 'List the cover catalogue (free first, then cheapest-first)' })
  @ApiOkResponse({ description: 'Cover catalogue' })
  list(): ProfileCover[] {
    return this.coversService.findAll();
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: "The caller's cover inventory",
    description: 'Returns the active cover id and the full owned set (free ids ∪ purchased ids).',
  })
  @ApiOkResponse({ description: 'Cover inventory `{ active, owned }`' })
  getMine(@CurrentUser('sub') userId: string): Promise<CoverInventory> {
    return this.coversService.getMine(userId);
  }

  @Post('purchase')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Buy a cover for the caller (debits coins, auto-activates)',
    description:
      'Atomically debits the caller and grants the cover, activating it. Returns ' +
      '422 on insufficient balance, 409 if the cover is free or already owned, ' +
      'and 404 if the cover does not exist.',
  })
  @ApiCreatedResponse({ description: 'The updated cover inventory `{ active, owned }`' })
  purchase(
    @CurrentUser('sub') userId: string,
    @Body(createZodValidationPipe(purchaseCoverSchema)) dto: PurchaseCoverDto,
  ): Promise<CoverInventory> {
    return this.coversService.purchase(userId, dto.coverId);
  }

  @Post('active')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: "Set the caller's active cover",
    description:
      'Switches the caller to an owned (or free) cover and returns the updated ' +
      'public profile so the hero updates instantly. Returns 403 if the cover is ' +
      'not owned and 404 if it does not exist.',
  })
  @ApiOkResponse({ description: 'The updated public profile' })
  setActive(
    @CurrentUser('sub') userId: string,
    @Body(createZodValidationPipe(purchaseCoverSchema)) dto: PurchaseCoverDto,
  ): Promise<PublicProfile> {
    return this.coversService.setActive(userId, dto.coverId);
  }
}
