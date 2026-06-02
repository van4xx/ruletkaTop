import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { EconomyOverview } from '@ruletka/shared-types';

import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';
import { AdminEconomyService } from './admin-economy.service';

/**
 * Admin economy dashboard, mounted under `/admin/economy`. Role-gated to
 * `moderator`/`admin` (class-level {@link JwtAuthGuard} + {@link RolesGuard} +
 * {@link Roles}), matching {@link AdminController}.
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
}
