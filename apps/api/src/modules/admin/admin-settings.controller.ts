import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  type AdminPatchSettingsDto,
  adminPatchSettingsSchema,
  type AdminPatchSettingsResult,
  type AdminSettings,
  type JwtPayload,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import { AdminSettingsService } from './admin-settings.service';
import { AuditService } from './audit.service';

/**
 * Admin settings surface, mounted under `/admin/settings`. Read is
 * `moderator`/`admin`; the patch (changing platform config) is `admin`-only and
 * audited.
 *
 * READ is REAL (env/config-derived flags + limits); PATCH is a STUB (env flags
 * require a restart). // TODO(wave2)
 */
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('moderator', 'admin')
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(
    private readonly settingsService: AdminSettingsService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Feature flags + throttle limits (env/config-derived)' })
  @ApiOkResponse({ description: 'Settings snapshot' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  settings(): AdminSettings {
    return this.settingsService.getSettings();
  }

  @Patch()
  @Roles('admin')
  @ApiOperation({ summary: 'Patch a flag (STUB — env flags need a restart; admin-only; audited)' })
  @ApiOkResponse({ description: 'Patch result + note' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  async patch(
    @Body(createZodValidationPipe(adminPatchSettingsSchema)) body: AdminPatchSettingsDto,
    @CurrentUser() caller: JwtPayload,
  ): Promise<AdminPatchSettingsResult> {
    const result = this.settingsService.patchSettings(body);
    await this.auditService.log({
      actorId: caller.sub,
      action: 'settings.patch',
      targetType: 'flag',
      targetId: body.key,
      meta: { value: body.value, applied: result.applied },
    });
    return result;
  }
}
