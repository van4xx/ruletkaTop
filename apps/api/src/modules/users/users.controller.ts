import { Controller, Delete, Get, Header, HttpCode, HttpStatus, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Response } from 'express';

import type { JwtPayload } from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ONE_MINUTE_MS } from '../../common/throttler/throttler.constants';
import { AccountExport, UsersService } from './users.service';

/**
 * Strict per-IP rate limit for the data-export endpoint: assembling a full copy
 * of one's data is an expensive multi-collection read, so it is capped tightly
 * (a handful per minute) to prevent abuse / DB hammering while still letting a
 * legitimate user retry. Overrides the generous global `default` throttler for
 * this one route via `@Throttle`.
 */
const EXPORT_THROTTLE_LIMIT = 3;

/** Refresh-cookie name — mirrors AuthController's `REFRESH_COOKIE`. */
const REFRESH_COOKIE = 'ruletka_rt';

/**
 * Authenticated account-management surface under `/users`.
 *
 * Exposes the 152-ФЗ / GDPR self-service privacy endpoints:
 *  - `DELETE /users/me` — right-to-be-forgotten: anonymizes the caller's account
 *    and all the personal data they own, revokes every session and clears the
 *    refresh cookie so the client is fully signed out.
 *  - `GET /users/me/export` — data-access / portability: streams a
 *    machine-readable JSON copy of the caller's data (the "copy of your data" the
 *    privacy policy promises). Rate-limited + audit-logged.
 */
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Erase the authenticated account (right to be forgotten, 152-ФЗ)',
  })
  @ApiNoContentResponse({ description: 'Account erased / anonymized (no content)' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async deleteMe(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.usersService.eraseAccount(user.sub);
    // Tear down the client session: erasure already removed the server-side
    // refresh sessions, so clear the (now-orphaned) refresh cookie too.
    this.clearRefreshCookie(res);
  }

  @Get('me/export')
  @UseGuards(JwtAuthGuard)
  // STRICT per-IP throttle (overrides the generous global `default`): a data
  // export is an expensive multi-collection read, so cap it tightly.
  @Throttle({ default: { limit: EXPORT_THROTTLE_LIMIT, ttl: ONE_MINUTE_MS } })
  // Offer it as a downloadable file rather than an inline body.
  @Header('Content-Disposition', 'attachment; filename="ruletka-data-export.json"')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Export a machine-readable copy of the authenticated account data (152-ФЗ / GDPR)',
  })
  @ApiOkResponse({ description: 'A JSON bundle of the caller-owned data (secrets excluded)' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async exportMe(@CurrentUser() user: JwtPayload): Promise<AccountExport> {
    // The JWT carries no email (only `sub`/`role`/`isPremium`), so the audit row
    // is keyed by the actor id; `exportAccount` records `user.data_export`.
    return this.usersService.exportAccount(user.sub);
  }

  /** Clear the refresh cookie. Attributes must match how AuthController set it. */
  private clearRefreshCookie(res: Response): void {
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';
    const globalPrefix = this.configService.get<string>('API_GLOBAL_PREFIX', 'api');
    const path = `/${globalPrefix}/auth`.replace(/\/+/g, '/');
    const options: Omit<CookieOptions, 'maxAge'> = {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      path,
    };
    res.clearCookie(REFRESH_COOKIE, options);
  }
}
