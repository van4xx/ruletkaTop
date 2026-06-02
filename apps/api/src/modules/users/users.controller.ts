import { Controller, Delete, HttpCode, HttpStatus, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { CookieOptions, Response } from 'express';

import type { JwtPayload } from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { UsersService } from './users.service';

/** Refresh-cookie name — mirrors AuthController's `REFRESH_COOKIE`. */
const REFRESH_COOKIE = 'ruletka_rt';

/**
 * Authenticated account-management surface under `/users`.
 *
 * Currently exposes the 152-ФЗ / GDPR right-to-be-forgotten endpoint
 * (`DELETE /users/me`), which anonymizes the caller's account and all the
 * personal data they own, then revokes every session and clears the refresh
 * cookie so the client is fully signed out.
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
