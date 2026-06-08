import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';

import {
  type AuthResponse,
  type AuthSession,
  type AuthUser,
  type ChangePasswordDto,
  changePasswordSchema,
  type JwtPayload,
  type LoginDto,
  loginSchema,
  type RefreshDto,
  refreshSchema,
  type RegisterDto,
  registerSchema,
  type RequestPasswordResetDto,
  requestPasswordResetSchema,
  type ResetPasswordDto,
  resetPasswordSchema,
  type VerifyEmailDto,
  verifyEmailSchema,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { AUTH_THROTTLER } from '../../common/throttler/throttler.constants';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuthService, type SessionContext } from './auth.service';

/**
 * Name of the httpOnly cookie carrying the refresh token. Scoped to the auth
 * path so it is only ever attached to `/auth/*` requests (refresh + logout),
 * never sent on ordinary API calls.
 */
const REFRESH_COOKIE = 'ruletka_rt';

/**
 * Non-httpOnly PRESENCE marker cookie (`ruletka_auth=1`) read by the Next.js edge
 * middleware to gate protected routes. Opaque value (never the token); the real
 * authority stays the bearer access token + server validation. Set by the API
 * alongside the refresh cookie so it is reliable regardless of client JS timing.
 */
const PRESENCE_COOKIE = 'ruletka_auth';

/** Default refresh-cookie lifetime (seconds) if `JWT_REFRESH_TTL` is unset. */
const DEFAULT_REFRESH_MAX_AGE_S = 30 * 24 * 60 * 60; // 30 days

/**
 * Authentication REST surface under `/auth`.
 *
 * ───────────────────────────── Token transport ─────────────────────────────
 * The REFRESH token is delivered ONLY as an httpOnly, SameSite=Lax cookie
 * (Secure in production), path-scoped to the auth routes — it is never readable
 * from JavaScript, so an XSS payload can't exfiltrate it. (Lax, not Strict — see
 * `refreshCookieOptions` for why Strict breaks the cross-subdomain refresh.) The response body
 * carries only the short-lived ACCESS token (the body's `tokens.refreshToken`
 * is intentionally blanked). `/auth/refresh` reads the token from the cookie,
 * with a legacy fallback to a request body for mid-migration clients, and
 * rotates the cookie. `/auth/logout` clears the cookie.
 *
 * `register`, `login` and `refresh` are public; `logout` and `me` require a
 * valid access token. Each session-minting route captures best-effort client
 * context (IP + User-Agent) for the persisted refresh session.
 */
@ApiTags('auth')
// Apply the STRICT per-IP `auth` throttler (configured in ThrottlerModule) to
// every credential route, overriding the generous global `default` limiter. An
// empty options object uses the named throttler's registered ttl/limit.
@Throttle({ [AUTH_THROTTLER]: {} })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new account (18+) and start a session' })
  @ApiCreatedResponse({
    description: 'The new user plus an access token (refresh set as httpOnly cookie)',
  })
  async register(
    @Body(createZodValidationPipe(registerSchema)) dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.authService.register(dto, this.contextFrom(req));
    return this.withRefreshCookie(res, result);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with email + password' })
  @ApiOkResponse({ description: 'The user plus an access token (refresh set as httpOnly cookie)' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials or banned account' })
  async login(
    @Body(createZodValidationPipe(loginSchema)) dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.authService.login(dto, this.contextFrom(req));
    return this.withRefreshCookie(res, result);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the refresh token (from cookie) for a new access token' })
  @ApiOkResponse({ description: 'A fresh access token (refresh cookie rotated)' })
  @ApiUnauthorizedResponse({ description: 'Invalid, expired or reused refresh token' })
  async refresh(
    // Body is OPTIONAL now (legacy clients may still send `{ refreshToken }`);
    // the cookie is the primary source.
    @Body(createZodValidationPipe(refreshSchema.partial().default({}))) dto: Partial<RefreshDto>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const token = this.readRefreshToken(req, dto);
    if (!token) {
      throw new UnauthorizedException('Missing refresh token');
    }
    const result = await this.authService.refresh(token, this.contextFrom(req));
    return this.withRefreshCookie(res, result);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Revoke the current refresh session and clear the refresh cookie',
  })
  @ApiOkResponse({ description: 'Session revoked (no content)' })
  async logout(
    @CurrentUser() user: JwtPayload,
    @Body(createZodValidationPipe(refreshSchema.partial().default({}))) dto: Partial<RefreshDto>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = this.readRefreshToken(req, dto);
    await this.authService.logout(user.sub, token ?? undefined);
    this.clearRefreshCookie(res);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Return the authenticated user' })
  @ApiOkResponse({ description: 'The current AuthUser' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async me(@CurrentUser() user: JwtPayload): Promise<AuthUser> {
    return this.authService.getAuthUser(user);
  }

  // ── Active sessions / devices ───────────────────────────────────────────────

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: "List the current user's active sessions (devices)" })
  @ApiOkResponse({ description: 'Active sessions, the requesting device flagged `current`' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async listSessions(
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ): Promise<AuthSession[]> {
    // The refresh cookie identifies which session is the requesting device so we
    // can flag it `current` (and protect it from "sign out everywhere").
    const currentToken = this.readRefreshToken(req, {});
    return this.authService.listSessions(user.sub, currentToken ?? undefined);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'id', description: 'Session id from GET /auth/sessions' })
  @ApiOperation({ summary: 'Revoke one session (sign out that device)' })
  @ApiNoContentResponse({ description: 'Session revoked (no content)' })
  @ApiNotFoundResponse({ description: 'No such session for the current user' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async revokeSession(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const revoked = await this.authService.revokeSession(user.sub, id);
    if (!revoked) {
      // Unknown / already-gone / not-owned id → 404 (never reveals other users').
      throw new NotFoundException('Session not found');
    }
    // If the caller revoked their OWN current session, clear its cookie too so
    // the next request doesn't ride a now-dead refresh token.
    const currentToken = this.readRefreshToken(req, {});
    if (currentToken && (await this.authService.isCurrentSession(user.sub, id, currentToken))) {
      this.clearRefreshCookie(res);
    }
  }

  @Delete('sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke all other sessions (keep the current device)' })
  @ApiNoContentResponse({ description: 'Other sessions revoked (no content)' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async revokeOtherSessions(
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ): Promise<void> {
    const currentToken = this.readRefreshToken(req, {});
    await this.authService.revokeOtherSessions(user.sub, currentToken ?? undefined);
  }

  // ── Email verification ──────────────────────────────────────────────────────

  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Confirm an email address with the emailed token' })
  @ApiNoContentResponse({ description: 'Email verified (token consumed)' })
  @ApiBadRequestResponse({ description: 'Invalid, expired or already-used token' })
  async verifyEmail(
    @Body(createZodValidationPipe(verifyEmailSchema)) dto: VerifyEmailDto,
  ): Promise<void> {
    await this.authService.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Re-send the verification email to the current user' })
  @ApiNoContentResponse({
    description: 'Verification email re-sent (no content); no-op if already verified',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  async resendVerification(@CurrentUser() user: JwtPayload): Promise<void> {
    await this.authService.resendVerification(user.sub);
  }

  // ── Password reset ────────────────────────────────────────────────────────

  @Post('request-password-reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Request a password-reset email (always 204)' })
  @ApiNoContentResponse({
    description:
      'Accepted (no content). Always succeeds — the response never reveals whether the email is registered.',
  })
  async requestPasswordReset(
    @Body(createZodValidationPipe(requestPasswordResetSchema))
    dto: RequestPasswordResetDto,
  ): Promise<void> {
    // Anti-enumeration: do not await-then-branch on existence — the service
    // silently no-ops for unknown emails and we always return 204.
    await this.authService.requestPasswordReset(dto.email);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set a new password with the emailed reset token' })
  @ApiNoContentResponse({
    description: 'Password changed (token consumed; all sessions revoked)',
  })
  @ApiBadRequestResponse({ description: 'Invalid/expired token or weak password' })
  async resetPassword(
    @Body(createZodValidationPipe(resetPasswordSchema)) dto: ResetPasswordDto,
  ): Promise<void> {
    await this.authService.resetPassword(dto.token, dto.password);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Change the current password (verifying the existing one)' })
  @ApiNoContentResponse({
    description: 'Password changed (all sessions revoked); the caller must re-authenticate',
  })
  @ApiUnauthorizedResponse({
    description: 'Missing/invalid access token or wrong current password',
  })
  @ApiBadRequestResponse({ description: 'Weak or unchanged new password' })
  async changePassword(
    @CurrentUser() user: JwtPayload,
    @Body(createZodValidationPipe(changePasswordSchema)) dto: ChangePasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.authService.changePassword(user.sub, dto, this.contextFrom(req));
  }

  // ── Cookie helpers ─────────────────────────────────────────────────────────

  /**
   * Set the refresh token as an httpOnly cookie and return the response with
   * the refresh token STRIPPED from the JSON body (only the access token is
   * exposed to JavaScript).
   */
  private withRefreshCookie(res: Response, result: AuthResponse): AuthResponse {
    res.cookie(REFRESH_COOKIE, result.tokens.refreshToken, this.refreshCookieOptions());
    res.cookie(PRESENCE_COOKIE, '1', this.presenceCookieOptions());
    return {
      user: result.user,
      tokens: { accessToken: result.tokens.accessToken, refreshToken: '' },
    };
  }

  /** Clear the refresh cookie (logout). Must mirror the set-cookie attributes. */
  private clearRefreshCookie(res: Response): void {
    const { maxAge: _maxAge, ...clearOptions } = this.refreshCookieOptions();
    res.clearCookie(REFRESH_COOKIE, clearOptions);
    const { maxAge: _presenceMaxAge, ...presenceClear } = this.presenceCookieOptions();
    res.clearCookie(PRESENCE_COOKIE, presenceClear);
  }

  /**
   * Read the refresh token, preferring the httpOnly cookie and falling back to
   * a legacy request body so clients mid-migration don't break.
   */
  private readRefreshToken(req: Request, dto: Partial<RefreshDto>): string | null {
    const cookies = (req as Request & { cookies?: Record<string, unknown> }).cookies;
    const fromCookie = cookies?.[REFRESH_COOKIE];
    if (typeof fromCookie === 'string' && fromCookie.length > 0) {
      return fromCookie;
    }
    if (typeof dto.refreshToken === 'string' && dto.refreshToken.length > 0) {
      return dto.refreshToken;
    }
    return null;
  }

  /**
   * Optional parent-domain for the auth cookies (`COOKIE_DOMAIN`, e.g.
   * `.ruletka.top` in prod). Sharing both cookies across `ruletka.top` +
   * `api.ruletka.top` lets the server-set presence marker reach the edge
   * middleware on the apex, and lets the refresh cookie ride the credentialed
   * cross-subdomain refresh. Blank in dev (localhost is single-origin) → the
   * cookie stays host-only, so `undefined` is returned and `res.cookie` omits
   * the `Domain` attribute entirely.
   */
  private cookieDomain(): string | undefined {
    const domain = this.configService.get<string>('COOKIE_DOMAIN');
    return domain && domain.length > 0 ? domain : undefined;
  }

  /**
   * Cookie attributes: httpOnly, Secure (prod/https), SameSite=Lax, /auth-scoped,
   * optional parent-domain. SameSite=Lax (not Strict) is correct for a
   * credentialed cross-subdomain refresh under a shared `COOKIE_DOMAIN`: Strict
   * can withhold the cookie after top-level redirects / some reload paths, which
   * surfaces as a spurious logout. The cookie is still httpOnly + Secure +
   * path-scoped to `/<prefix>/auth`, so it never rides ordinary API calls.
   */
  private refreshCookieOptions(): CookieOptions {
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';
    const globalPrefix = this.configService.get<string>('API_GLOBAL_PREFIX', 'api');
    // The auth routes live under `/<prefix>/auth`; scope the cookie there so it
    // is only attached to refresh/logout, never to ordinary API requests.
    const path = `/${globalPrefix}/auth`.replace(/\/+/g, '/');
    return {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path,
      domain: this.cookieDomain(),
      maxAge: this.refreshMaxAgeMs(),
    };
  }

  /**
   * Presence-marker cookie options: non-httpOnly, root-path, SameSite=Lax,
   * optional parent-domain so it rides the top-level navigations the edge
   * middleware gates on and is visible on the apex when the API lives on a
   * sibling subdomain.
   */
  private presenceCookieOptions(): CookieOptions {
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';
    return {
      httpOnly: false,
      secure: isProd,
      sameSite: 'lax',
      path: '/',
      domain: this.cookieDomain(),
      maxAge: this.refreshMaxAgeMs(),
    };
  }

  /** Refresh-cookie lifetime in ms, derived from `JWT_REFRESH_TTL` (ms string). */
  private refreshMaxAgeMs(): number {
    const ttl = this.configService.get<string>('JWT_REFRESH_TTL', '30d');
    const seconds = parseTtlSeconds(ttl) ?? DEFAULT_REFRESH_MAX_AGE_S;
    return seconds * 1000;
  }

  /** Best-effort `{ ip, userAgent }` for the persisted refresh session. */
  private contextFrom(req: Request): SessionContext {
    const userAgent = req.headers['user-agent'];
    return {
      ip: req.ip ?? null,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
    };
  }
}

/**
 * Parse a small subset of `ms`-style TTL strings ('30d', '900s', '15m', '12h')
 * or a bare number-of-seconds into whole seconds. Returns `null` if unparseable
 * so the caller can fall back to a sane default.
 */
function parseTtlSeconds(ttl: string): number | null {
  const trimmed = ttl.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  const match = /^(\d+)\s*(s|m|h|d)$/i.exec(trimmed);
  if (!match || match[1] === undefined || match[2] === undefined) {
    return null;
  }
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return value * multiplier;
}
