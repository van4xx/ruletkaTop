import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { AdminSecurityEventList, AdminSessionList } from '@ruletka/shared-types';

import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';
import { AdminSecurityService } from './admin-security.service';

/**
 * Admin security surface, mounted under `/admin/security`. The security console
 * is `admin`-only (sessions + events expose sensitive client context).
 *
 * REAL: `GET /sessions` (auth `sessions` collection) and `GET /events` (a
 * unified feed aggregated from banned users + banned fingerprints + revoked
 * sessions, read by name via the shared connection — WAVE-2).
 */
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin/security')
export class AdminSecurityController {
  constructor(private readonly securityService: AdminSecurityService) {}

  @Get('sessions')
  @ApiOperation({ summary: 'Recent refresh sessions + live-session count' })
  @ApiOkResponse({ description: 'Sessions + active count' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  async sessions(): Promise<AdminSessionList> {
    return this.securityService.listSessions();
  }

  @Get('events')
  @ApiOperation({
    summary: 'Security events feed (banned users + banned fingerprints + revoked sessions)',
  })
  @ApiOkResponse({ description: 'Security events' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  async events(): Promise<AdminSecurityEventList> {
    return this.securityService.listEvents();
  }
}
