import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import {
  referralBindDtoSchema,
  type JwtPayload,
  type ReferralBindDto,
  type ReferralListResponse,
  type ReferralLookupResponse,
  type ReferralMeResponse,
  type ReferralTier,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import { ReferralsService } from './referrals.service';

/**
 * Authenticated `/referrals` surface — JWT-guarded class.
 *
 *  - `GET  /referrals/me`                 → link + per-tier stats
 *  - `GET  /referrals/me/list?tier=1|2|3` → cursor-paginated downline
 *  - `POST /referrals/bind`               → attach a fresh account to an inviter
 *
 * The PUBLIC `GET /referrals/lookup/:code` lives in
 * {@link ReferralsPublicController} below so the class-level `JwtAuthGuard`
 * does not gate the register-page preview (the user has no session yet there).
 */
@ApiTags('referrals')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get('me')
  @ApiOperation({
    summary: "Read the authenticated user's referral link + downline aggregates",
  })
  @ApiOkResponse({ description: 'Code, share link, and per-tier stats' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async getMe(@CurrentUser() user: JwtPayload): Promise<ReferralMeResponse> {
    return this.referralsService.getMe(user.sub);
  }

  @Get('me/list')
  @ApiOperation({
    summary: 'Cursor-paginated downline list scoped to one tier (1, 2 or 3)',
    description:
      'Returns minimal public profile (nickname + avatar) of each invitee + a ' +
      '`hasMadeFirstPurchase` flag derived from the canonical T1 row. Cursors ' +
      'are `_id` keysets in `{ inviterId, tier, _id:-1 }` index order.',
  })
  @ApiOkResponse({ description: 'Page of downline members + pagination meta' })
  @ApiBadRequestResponse({ description: 'Invalid `tier` or `cursor`' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async listDownline(
    @CurrentUser() user: JwtPayload,
    @Query('tier') tierRaw?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitRaw?: string,
  ): Promise<ReferralListResponse> {
    const tier = this.parseTier(tierRaw);
    const limit = this.parseLimit(limitRaw);
    return this.referralsService.listDownline(user.sub, tier, cursor ?? null, limit);
  }

  @Post('bind')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Attach the authenticated user to an inviter by code',
    description:
      'One inviter per invitee, set at signup. The server walks the chain UP ' +
      'and inserts up to three edges (T1/T2/T3). A second bind attempt 409s.',
  })
  @ApiNoContentResponse({ description: 'Bound (or already bound earlier in this signup)' })
  @ApiBadRequestResponse({ description: 'Bad code or self-referral' })
  @ApiConflictResponse({ description: 'Already bound to a referrer' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async bind(
    @CurrentUser() user: JwtPayload,
    @Body(createZodValidationPipe(referralBindDtoSchema)) dto: ReferralBindDto,
  ): Promise<void> {
    await this.referralsService.bind(user.sub, dto.code);
  }

  // ── tiny parsers ────────────────────────────────────────────────────────

  /** Parse the `tier` query into 1 | 2 | 3 (400 otherwise). */
  private parseTier(raw: string | undefined): ReferralTier {
    const n = Number.parseInt(raw ?? '1', 10);
    if (n === 1 || n === 2 || n === 3) {
      return n;
    }
    throw new BadRequestException('tier must be 1, 2 or 3');
  }

  /** Parse the `limit` query, clamped to 1..100 with a default of 20. */
  private parseLimit(raw: string | undefined): number {
    if (raw === undefined || raw === '') return 20;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return 20;
    return Math.min(100, n);
  }
}

/**
 * Public, UNAUTHENTICATED preview route — split into its own controller class
 * so the class-level `JwtAuthGuard` on {@link ReferralsController} does NOT
 * gate it (no @Public() metadata exists in this codebase). The register page
 * calls this BEFORE the user has any session, so the response carries only
 * the inviter's public nickname — NO id, NO email, NO PII.
 */
@ApiTags('referrals')
@Controller('referrals')
export class ReferralsPublicController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get('lookup/:code')
  @ApiOperation({
    summary: 'Public lookup of a referral code → inviter nickname',
    description:
      'Always returns 200 — `valid: false` for an unknown code so the register ' +
      'form stays functional even with a stale `?ref=`.',
  })
  @ApiOkResponse({ description: 'Public preview of the inviter (nickname only)' })
  async lookup(@Param('code') code: string): Promise<ReferralLookupResponse> {
    return this.referralsService.lookupCode(code);
  }
}
