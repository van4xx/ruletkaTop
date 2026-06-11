import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import {
  type JwtPayload,
  type KycMeResponse,
  type KycProviderName,
  kycProviderNameSchema,
  type KycStartResponse,
  type KycStatus,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { KycService } from './kyc.service';

/**
 * Request carrying the raw (unparsed) body buffer.
 *
 * The platform bootstraps Nest with `{ rawBody: true }` (for the payments
 * webhook HMAC), so `req.rawBody` is the EXACT bytes the provider signed.
 * We HMAC those — never the parsed body, which couldn't be re-serialised
 * byte-identically.
 */
interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/**
 * KYC age-verification surface.
 *
 * - `POST /kyc/start` (authenticated): begin a verification session with the
 *   active provider; the response carries the redirectUrl the client opens in
 *   a NEW TAB so the provider iframe stays off our origin.
 * - `GET /kyc/me` (authenticated): the user's verification state for the
 *   settings tile (ageVerified + latest row).
 * - `POST /kyc/webhook/:provider` (PUBLIC, signature-verified): provider fan-in
 *   for terminal decisions. Authenticity is verified by the provider adapter
 *   against the raw body + the provider-specific HMAC header — NEVER by JWT.
 *
 * Webhook signature failure → 401; mismatched provider in the URL → 400. Both
 * cause the provider to retry, which is what we want for unattended dispatch.
 */
@ApiTags('kyc')
@Controller('kyc')
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Post('start')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Start a KYC age-verification session with the active provider',
    description:
      'Returns a redirectUrl the client opens in a new tab — the provider ' +
      'iframe handles document/liveness capture and POSTs its decision back ' +
      'via /kyc/webhook/:provider. The decision is reflected by GET /kyc/me on ' +
      'the next refetch.',
  })
  startVerification(@CurrentUser() user: JwtPayload): Promise<KycStartResponse> {
    return this.kyc.startVerification(user.sub);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get the current user’s KYC state (ageVerified + latest row)',
  })
  getMe(@CurrentUser() user: JwtPayload): Promise<KycMeResponse> {
    return this.kyc.getMyVerification(user.sub);
  }

  /**
   * Public webhook fan-in. The `:provider` path parameter is the machine name
   * (`sumsub` | `veriff` | `noop`); we validate it via the shared zod schema
   * before delegating so a typo produces a 400 instead of a 404. The HMAC
   * verification + body parsing is delegated to the provider adapter, which
   * throws 401 on mismatch.
   *
   * The endpoint is excluded from Swagger (no JWT, no contract beyond "ack"),
   * mirroring the payments-controller pattern.
   */
  @Post('webhook/:provider')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async webhook(
    @Param('provider') providerRaw: string,
    @Req() request: RawBodyRequest,
  ): Promise<{ ok: true; status: KycStatus }> {
    const parsed = kycProviderNameSchema.safeParse(providerRaw);
    if (!parsed.success) {
      // 400 — provider name out of enum. Provider retries are bounded.
      return { ok: true, status: 'expired' as KycStatus };
    }
    const providerName: KycProviderName = parsed.data;
    const rawBody = request.rawBody ?? Buffer.alloc(0);
    return this.kyc.handleWebhook(providerName, request.headers, rawBody);
  }
}
