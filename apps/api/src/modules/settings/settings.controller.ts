import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  type JwtPayload,
  type Settings,
  type UpdateSettingsDto,
  updateSettingsSchema,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import { SettingsService } from './settings.service';

/**
 * Authenticated REST surface for the caller's own application settings under
 * `/settings`. Both routes operate exclusively on `@CurrentUser()`'s document.
 */
@ApiTags('settings')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: "Fetch the authenticated user's settings" })
  @ApiOkResponse({ description: 'Full settings document (defaults on first read)' })
  async getSettings(@CurrentUser() user: JwtPayload): Promise<Settings> {
    return this.settingsService.getOrCreate(user.sub);
  }

  @Patch()
  @ApiOperation({ summary: "Update the authenticated user's settings (partial)" })
  @ApiOkResponse({ description: 'Updated settings document' })
  async updateSettings(
    @CurrentUser() user: JwtPayload,
    @Body(createZodValidationPipe(updateSettingsSchema)) dto: UpdateSettingsDto,
  ): Promise<Settings> {
    return this.settingsService.update(user.sub, dto);
  }
}
