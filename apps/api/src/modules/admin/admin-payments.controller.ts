import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { AdminPaymentList, AdminPaymentStats } from '@ruletka/shared-types';

import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';
import { AdminPaymentsService } from './admin-payments.service';

/**
 * Admin payments surface, mounted under `/admin/payments`. Role-gated to
 * `moderator`/`admin`. REAL — reads the `payments` collection.
 */
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('moderator', 'admin')
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(private readonly paymentsService: AdminPaymentsService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Revenue + status-funnel aggregates' })
  @ApiOkResponse({ description: 'Payment stats' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async stats(): Promise<AdminPaymentStats> {
    return this.paymentsService.getStats();
  }

  @Get()
  @ApiOperation({ summary: 'List charges (cursor-paginated, newest first)' })
  @ApiOkResponse({ description: 'A page of charges' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async list(@Query('cursor') cursor?: string): Promise<AdminPaymentList> {
    return this.paymentsService.list(cursor);
  }
}
