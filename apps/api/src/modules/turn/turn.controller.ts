import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { TurnService, type TurnCredentials } from './turn.service';

/**
 * Issues ephemeral WebRTC ICE configuration under `/turn`.
 *
 * `GET /turn/credentials` returns STUN + time-limited TURN credentials bound to
 * the authenticated user (coturn `use-auth-secret` scheme). The web client
 * fetches this right before establishing an `RTCPeerConnection` and passes the
 * `iceServers` array straight into its constructor.
 */
@ApiTags('turn')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('turn')
export class TurnController {
  constructor(private readonly turnService: TurnService) {}

  @Get('credentials')
  @ApiOperation({
    summary: 'Mint ephemeral STUN/TURN ICE credentials for WebRTC',
    description:
      'Returns an `iceServers` array (STUN + time-limited TURN credentials, ' +
      'valid ~1h) for the caller to pass into RTCPeerConnection. Credentials ' +
      'are HMAC-derived from a server-only secret and self-expire; no per-user ' +
      'TURN state is stored.',
  })
  @ApiOkResponse({
    description: 'ICE server configuration ready for RTCPeerConnection.',
    schema: {
      type: 'object',
      properties: {
        iceServers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              urls: { type: 'array', items: { type: 'string' } },
              username: { type: 'string' },
              credential: { type: 'string' },
            },
          },
        },
        ttlExpiresAt: {
          type: 'number',
          description: 'Unix epoch (seconds) when the TURN credential expires.',
        },
      },
    },
  })
  getCredentials(@CurrentUser() user: JwtPayload): TurnCredentials {
    return this.turnService.mintCredentials(user.sub);
  }
}
