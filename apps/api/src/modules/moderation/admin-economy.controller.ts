import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import type { EconomyOverview } from '@ruletka/shared-types';

import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';
import {
  type AdminCoinPackageRow,
  type AdminGiftRow,
  type AdminTopPlacementRow,
  AdminEconomyService,
  type CreateCoinPackageDto,
  type CreateGiftDto,
  type UpdateCoinPackageDto,
  type UpdateGiftDto,
} from './admin-economy.service';

/**
 * Admin economy console, mounted under `/admin/economy`.
 *
 * The class gate is `moderator`/`admin` (read access — {@link JwtAuthGuard} +
 * {@link RolesGuard} + {@link Roles}, matching {@link AdminController}); every
 * MUTATING route NARROWS that to `admin`-only with a method-level
 * `@Roles('admin')` (the pattern {@link AdminController} uses for the
 * fingerprint-delete route). Bodies are validated in the service, which throws
 * the project's standard `BadRequest`/`Conflict`/`NotFound` exceptions.
 *
 * All three catalogues are REAL Mongo collections accessed by name via the
 * shared connection (`coinpackages`, `gifts`, `topplacements`) — no Wallet/
 * Gifts/Top module import required.
 */
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('moderator', 'admin')
@Controller('admin/economy')
export class AdminEconomyController {
  constructor(private readonly adminEconomyService: AdminEconomyService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Economy + population snapshot (counts, coins in circulation, recent ledger)',
  })
  @ApiOkResponse({ description: 'The economy overview' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async overview(): Promise<EconomyOverview> {
    return this.adminEconomyService.getOverview();
  }

  // ── Coin packages (`coinpackages`) ────────────────────────────────────────

  @Get('coin-packages')
  @ApiOperation({ summary: 'List the coin-package catalogue (cheapest first)' })
  @ApiOkResponse({ description: 'All coin packages' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async listCoinPackages(): Promise<AdminCoinPackageRow[]> {
    return this.adminEconomyService.listCoinPackages();
  }

  @Post('coin-packages')
  @Roles('admin') // narrows the class gate: catalogue writes are admin-ONLY
  @ApiOperation({ summary: 'Create a coin package (admin-only)' })
  @ApiOkResponse({ description: 'The created package' })
  @ApiBadRequestResponse({ description: 'Invalid body' })
  @ApiConflictResponse({ description: 'A package with that code already exists' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  async createCoinPackage(@Body() body: CreateCoinPackageDto): Promise<AdminCoinPackageRow> {
    return this.adminEconomyService.createCoinPackage(body);
  }

  @Patch('coin-packages/:id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update a coin package (price/coins/bonus; admin-only)' })
  @ApiParam({ name: 'id', description: 'Coin-package id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'The updated package' })
  @ApiBadRequestResponse({ description: 'Invalid body' })
  @ApiNotFoundResponse({ description: 'No such package' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  async updateCoinPackage(
    @Param('id') id: string,
    @Body() body: UpdateCoinPackageDto,
  ): Promise<AdminCoinPackageRow> {
    return this.adminEconomyService.updateCoinPackage(id, body);
  }

  @Delete('coin-packages/:id')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete a coin package (admin-only)' })
  @ApiParam({ name: 'id', description: 'Coin-package id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'The deleted package id' })
  @ApiNotFoundResponse({ description: 'No such package' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  async deleteCoinPackage(@Param('id') id: string): Promise<{ id: string }> {
    return this.adminEconomyService.deleteCoinPackage(id);
  }

  // ── Gifts (`gifts`) ───────────────────────────────────────────────────────

  @Get('gifts')
  @ApiOperation({ summary: 'List the gift catalogue (cheapest first)' })
  @ApiOkResponse({ description: 'All gifts' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async listGifts(): Promise<AdminGiftRow[]> {
    return this.adminEconomyService.listGifts();
  }

  @Post('gifts')
  @Roles('admin')
  @ApiOperation({ summary: 'Create a gift (admin-only)' })
  @ApiOkResponse({ description: 'The created gift' })
  @ApiBadRequestResponse({ description: 'Invalid body' })
  @ApiConflictResponse({ description: 'A gift with that code already exists' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  async createGift(@Body() body: CreateGiftDto): Promise<AdminGiftRow> {
    return this.adminEconomyService.createGift(body);
  }

  @Patch('gifts/:id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update a gift (name/icon/price/rarity/premium; admin-only)' })
  @ApiParam({ name: 'id', description: 'Gift id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'The updated gift' })
  @ApiBadRequestResponse({ description: 'Invalid body' })
  @ApiNotFoundResponse({ description: 'No such gift' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  async updateGift(@Param('id') id: string, @Body() body: UpdateGiftDto): Promise<AdminGiftRow> {
    return this.adminEconomyService.updateGift(id, body);
  }

  @Delete('gifts/:id')
  @Roles('admin')
  @ApiOperation({
    summary: 'Delete a gift (admin-only; past sends keep their denormalised price)',
  })
  @ApiParam({ name: 'id', description: 'Gift id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'The deleted gift id' })
  @ApiNotFoundResponse({ description: 'No such gift' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  async deleteGift(@Param('id') id: string): Promise<{ id: string }> {
    return this.adminEconomyService.deleteGift(id);
  }

  // ── Top placements (`topplacements`) ──────────────────────────────────────

  @Get('top')
  @ApiOperation({
    summary: 'List top placements (active first, then recent) joined to the promoted account',
  })
  @ApiOkResponse({ description: 'Top placements with who occupies them' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async listTopPlacements(): Promise<AdminTopPlacementRow[]> {
    return this.adminEconomyService.listTopPlacements();
  }

  @Delete('top/:id')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ApiOperation({ summary: 'Remove (take down) a top placement (admin-only)' })
  @ApiParam({ name: 'id', description: 'Placement id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'The removed placement id' })
  @ApiNotFoundResponse({ description: 'No such placement' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  async removeTopPlacement(@Param('id') id: string): Promise<{ id: string }> {
    return this.adminEconomyService.removeTopPlacement(id);
  }
}
