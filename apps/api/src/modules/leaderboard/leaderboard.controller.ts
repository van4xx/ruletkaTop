import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import {
  type JwtPayload,
  type LeaderboardQuery,
  leaderboardQuerySchema,
  type LeaderboardResponse,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import { LeaderboardService } from './leaderboard.service';

/**
 * Authenticated leaderboard surface under `/leaderboard`.
 *
 * `GET /leaderboard?metric=&limit=` returns the top `limit` users for the chosen
 * metric (`gifts` received-value · `coins` balance · `top` days), each joined to
 * their display profile, plus the caller's own rank as `me` when they fall
 * outside the returned slice. Requires auth so `me` can be resolved.
 */
@ApiTags('leaderboard')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get()
  @ApiOperation({ summary: 'Ranked leaderboard for a metric (+ the caller as `me`)' })
  @ApiQuery({
    name: 'metric',
    required: false,
    description: "'gifts' | 'coins' | 'top' (default 'gifts')",
  })
  @ApiQuery({ name: 'limit', required: false, description: 'Top N (1–100, default 50)' })
  @ApiOkResponse({ description: "Ranked entries + the caller's own rank" })
  async getLeaderboard(
    @CurrentUser() user: JwtPayload,
    @Query(createZodValidationPipe(leaderboardQuerySchema)) query: LeaderboardQuery,
  ): Promise<LeaderboardResponse> {
    return this.leaderboardService.getLeaderboard(query, user.sub);
  }
}
