import {
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
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  type Appeal,
  type CreateAppealDto,
  createAppealSchema,
  type JwtPayload,
  type ResolvedAppeal,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';
import { AUTH_THROTTLER } from '../../common/throttler/throttler.constants';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import { type AppealPage, AppealsService } from './appeals.service';
import {
  type ListAppealsQuery,
  listAppealsQuerySchema,
  type ResolveAppealDto,
  resolveAppealSchema,
} from './moderation.contracts';

/**
 * Ban-appeal surface.
 *
 * `POST /moderation/appeal` is PUBLIC (no JWT) by design: a banned user cannot
 * authenticate, so the appeal re-proves identity with email + password (verified
 * in {@link AppealsService}). It carries the STRICT `auth` throttler since it is
 * a credential-checking endpoint.
 *
 * The review routes (`GET /moderation/appeals`, `POST /moderation/appeals/:id/
 * resolve`) require a valid access token AND the `moderator`/`admin` role
 * (method-level {@link JwtAuthGuard} + {@link RolesGuard}). There is no
 * class-level guard precisely so the submit route can stay public.
 */
@Controller()
export class AppealsController {
  constructor(private readonly appealsService: AppealsService) {}

  // ── User surface (PUBLIC — banned users have no access token) ────────────────

  @Post('moderation/appeal')
  @HttpCode(HttpStatus.CREATED)
  // Strict per-IP credential limiter (same as login/register), since this verifies
  // an email + password.
  @Throttle({ [AUTH_THROTTLER]: {} })
  @ApiOperation({
    summary:
      'Submit a ban appeal (email + password verified; the account must be banned). ' +
      'Public — a banned user cannot hold an access token.',
  })
  @ApiCreatedResponse({ description: 'The created appeal (status: pending)' })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  @ApiForbiddenResponse({ description: 'The account is not banned' })
  async submitAppeal(
    @Body(createZodValidationPipe(createAppealSchema)) dto: CreateAppealDto,
  ): Promise<Appeal> {
    return this.appealsService.submitAppeal(dto);
  }

  // ── Moderator triage (role-guarded) ──────────────────────────────────────────

  @Get('moderation/appeals')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('moderator', 'admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'List ban appeals for triage (moderator/admin)' })
  @ApiOkResponse({ description: 'Cursor-paginated appeals, newest first' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async listAppeals(
    @Query(createZodValidationPipe(listAppealsQuerySchema)) query: ListAppealsQuery,
  ): Promise<AppealPage> {
    return this.appealsService.listAppeals(
      { cursor: query.cursor, limit: query.limit },
      query.status,
    );
  }

  @Post('moderation/appeals/:id/resolve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('moderator', 'admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Accept (⇒ unban the user) or reject a ban appeal (moderator/admin)',
  })
  @ApiParam({ name: 'id', description: 'Appeal id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'The decided appeal + the resulting ban state' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async resolveAppeal(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(createZodValidationPipe(resolveAppealSchema)) dto: ResolveAppealDto,
  ): Promise<ResolvedAppeal> {
    return this.appealsService.resolve(id, dto.status, user.sub);
  }
}
