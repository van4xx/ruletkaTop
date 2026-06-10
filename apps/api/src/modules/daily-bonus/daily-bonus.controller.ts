import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import type {
  DailyBonusClaimResponse,
  DailyBonusState,
  JwtPayload,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { DailyBonusService } from './daily-bonus.service';

/** Strict per-user claim throttle (10/min). The state read keeps the global default. */
const CLAIM_THROTTLE_LIMIT = 10;
const ONE_MINUTE_MS = 60_000;

/**
 * Authenticated daily-bonus surface under `/economy/daily-bonus`.
 *
 *  - `GET  /economy/daily-bonus`         — read the live state (streak,
 *    claimedToday, nextRewardCoins, ladder, nextResetAt, lifetimeCoins).
 *  - `POST /economy/daily-bonus/claim`   — credit today's coins, advance the
 *    streak. STRICT throttle so a held-down button can't grind the wallet.
 *
 * Both routes act on `@CurrentUser()`'s row only — the service never reads
 * across accounts.
 */
@ApiTags('economy')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('economy/daily-bonus')
export class DailyBonusController {
  constructor(private readonly dailyBonusService: DailyBonusService) {}

  @Get()
  @ApiOperation({ summary: "Read the authenticated user's daily-bonus state" })
  @ApiOkResponse({ description: 'Daily-bonus state (lazily materialised on first read)' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async getState(@CurrentUser() user: JwtPayload): Promise<DailyBonusState> {
    return this.dailyBonusService.getState(user.sub);
  }

  @Post('claim')
  // Override the generous global `default` limiter with a strict 10/min cap on
  // the claim — a runaway client can't grind the wallet, and the cheap 409
  // short-circuit inside the service still keeps a normal retried claim fast.
  @Throttle({ default: { limit: CLAIM_THROTTLE_LIMIT, ttl: ONE_MINUTE_MS } })
  @ApiOperation({
    summary: "Claim today's daily bonus (credits coins, advances the streak)",
    description:
      'Returns the post-claim state plus `justCredited` (the amount this call ' +
      'added to the wallet). 409 Conflict when the caller has already claimed today.',
  })
  @ApiOkResponse({ description: 'Coins credited; streak advanced' })
  @ApiConflictResponse({ description: 'Already claimed today' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async claim(@CurrentUser() user: JwtPayload): Promise<DailyBonusClaimResponse> {
    return this.dailyBonusService.claim(user.sub);
  }
}
