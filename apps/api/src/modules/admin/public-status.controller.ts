import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { PublicStatus } from '@ruletka/shared-types';

import { SettingsService } from './settings.service';

/**
 * UNAUTHENTICATED public operational status, mounted at `GET /public/status`.
 *
 * Unlike the rest of the admin surface this carries NO auth guard — the web and
 * mobile shells poll it on load (and the web middleware can read it) to show a
 * maintenance banner and pre-disable register / "start matching" before the user
 * hits a gated endpoint. It exposes ONLY the live operational flags
 * ({@link SettingsService.getPublicStatus}); no env value, secret, limit or PII
 * is ever surfaced here.
 *
 * The server still ENFORCES each flag independently (registration `403`,
 * matchmaking `ws:error`); this endpoint is a UX hint, never the enforcement.
 */
@ApiTags('public')
@Controller('public')
export class PublicStatusController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('status')
  @ApiOperation({
    summary: 'Public operational status (maintenance / registration / matchmaking) — unauthenticated',
  })
  @ApiOkResponse({ description: 'The live public status flags' })
  status(): Promise<PublicStatus> {
    return this.settingsService.getPublicStatus();
  }
}
