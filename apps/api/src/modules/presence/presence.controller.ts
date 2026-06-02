import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import type { PresencePayload } from '@ruletka/shared-types';

import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { PresenceService } from './presence.service';

/**
 * Read-only presence lookups. Writes happen over the realtime layer
 * (socket connect / `presence:heartbeat`) and via cross-module service calls,
 * never through REST, so there is no write endpoint here.
 */
@ApiTags('presence')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('presence')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Get(':id')
  @ApiOperation({ summary: "Get a user's current online status" })
  @ApiParam({ name: 'id', description: 'Target user id (Mongo ObjectId)' })
  @ApiOkResponse({
    description: 'The latest known presence for the user.',
    schema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        status: { type: 'string', enum: ['online', 'offline', 'in_call', 'away'] },
      },
    },
  })
  async getStatus(@Param('id') id: string): Promise<PresencePayload> {
    const status = await this.presence.getStatus(id);
    return { userId: id, status };
  }
}
