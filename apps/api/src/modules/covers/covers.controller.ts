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
  type EquipFrameDto,
  type FrameDesign,
  type JwtPayload,
  type ProfileCover,
  type PublicProfile,
  type PurchaseCoverDto,
  type PurchaseFrameDto,
  type UserFrame,
  equipFrameSchema,
  purchaseCoverSchema,
  purchaseFrameSchema,
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

/**
 * REST surface for avatar-frame cosmetics under `/frames`.
 *
 * Lives in the same module as covers (the catalogue + ownership flow shares
 * the {@link CoversService}). Public catalogue read; the rest require a valid
 * access token and only ever act on the AUTHENTICATED caller's own profile.
 *
 * Endpoints:
 *   GET  /frames/catalogue → FrameDesign[]   (public catalogue, free-first)
 *   GET  /frames/owned     → UserFrame       (auth; { equipped, owned })
 *   POST /frames/purchase  → UserFrame       (auth; debits coins, auto-equips)
 *   POST /frames/equip     → PublicProfile   (auth; switch / unequip)
 */
@ApiTags('frames')
@Controller('frames')
export class FramesController {
  constructor(private readonly coversService: CoversService) {}

  @Get('catalogue')
  @ApiOperation({ summary: 'List the avatar-frame catalogue (free first, then cheapest-first)' })
  @ApiOkResponse({ description: 'Frame catalogue' })
  catalogue(): FrameDesign[] {
    return this.coversService.findAllFrames();
  }

  @Get('owned')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: "The caller's frame inventory",
    description:
      'Returns the equipped frame id (or `null` when no frame is worn) and the ' +
      'full owned set (free ids ∪ purchased ids).',
  })
  @ApiOkResponse({ description: 'Frame inventory `{ equipped, owned }`' })
  owned(@CurrentUser('sub') userId: string): Promise<UserFrame> {
    return this.coversService.getMyFrames(userId);
  }

  @Post('purchase')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Buy a frame for the caller (debits coins, auto-equips)',
    description:
      'Atomically debits the caller and grants the frame, equipping it. Returns ' +
      '422 on insufficient balance, 409 if the frame is free or already owned, ' +
      'and 404 if the frame does not exist.',
  })
  @ApiCreatedResponse({ description: 'The updated frame inventory `{ equipped, owned }`' })
  purchase(
    @CurrentUser('sub') userId: string,
    @Body(createZodValidationPipe(purchaseFrameSchema)) dto: PurchaseFrameDto,
  ): Promise<UserFrame> {
    return this.coversService.purchaseFrame(userId, dto.frameId);
  }

  @Post('equip')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: "Equip / unequip the caller's avatar frame",
    description:
      'Switches the caller to an owned (or free) frame, or pass `frameId: null` ' +
      'to unequip the current frame. Returns the updated public profile so the ' +
      'hero updates instantly. Returns 403 if the frame is not owned, 404 if it ' +
      'does not exist.',
  })
  @ApiOkResponse({ description: 'The updated public profile' })
  equip(
    @CurrentUser('sub') userId: string,
    @Body(createZodValidationPipe(equipFrameSchema)) dto: EquipFrameDto,
  ): Promise<PublicProfile> {
    return this.coversService.equipFrame(userId, dto.frameId);
  }
}
