import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { AdminCallList, AdminCallsStats } from '@ruletka/shared-types';

import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';
import { AdminCallsService } from './admin-calls.service';

/**
 * Admin calls surface, mounted under `/admin/calls`. Role-gated to
 * `moderator`/`admin`. REAL — reads the `matches` collection.
 */
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('moderator', 'admin')
@Controller('admin/calls')
export class AdminCallsController {
  constructor(private readonly callsService: AdminCallsService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Call volume + modality mix + live count + mean duration' })
  @ApiOkResponse({ description: 'Calls stats' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async stats(): Promise<AdminCallsStats> {
    return this.callsService.getStats();
  }

  @Get('recent')
  @ApiOperation({ summary: 'The newest calls/matches' })
  @ApiOkResponse({ description: 'Recent calls' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async recent(): Promise<AdminCallList> {
    return this.callsService.getRecent();
  }
}
