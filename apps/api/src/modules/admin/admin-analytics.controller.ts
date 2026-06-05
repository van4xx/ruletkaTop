import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  type AdminAnalyticsOverview,
  type AdminTimeseries,
  type AdminTimeseriesQuery,
  adminTimeseriesQuerySchema,
} from '@ruletka/shared-types';

import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import { AdminAnalyticsService } from './admin-analytics.service';

/**
 * Admin analytics, mounted under `/admin/analytics`. Role-gated to
 * `moderator`/`admin`. Both endpoints are REAL — computed on read from existing
 * collections + Redis presence (no new tracking).
 */
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('moderator', 'admin')
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly analyticsService: AdminAnalyticsService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Headline KPIs (users/online/new/premium/banned, coins, revenue, calls, open reports)',
  })
  @ApiOkResponse({ description: 'The analytics overview' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async overview(): Promise<AdminAnalyticsOverview> {
    return this.analyticsService.getOverview();
  }

  @Get('timeseries')
  @ApiOperation({ summary: 'Per-day series for a metric (signups/revenue/calls) over a range' })
  @ApiOkResponse({ description: 'Zero-filled daily series' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async timeseries(
    @Query(createZodValidationPipe(adminTimeseriesQuerySchema)) query: AdminTimeseriesQuery,
  ): Promise<AdminTimeseries> {
    return this.analyticsService.getTimeseries(query);
  }
}
