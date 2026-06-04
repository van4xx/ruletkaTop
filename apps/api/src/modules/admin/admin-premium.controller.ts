import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import {
  type AdminGrantPremiumDto,
  adminGrantPremiumSchema,
  type AdminPremiumList,
  type JwtPayload,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import { AdminPremiumService } from './admin-premium.service';
import { AuditService } from './audit.service';

/**
 * Admin premium surface, mounted under `/admin/premium`. The list is
 * `moderator`/`admin`; grant/revoke (which change entitlement) narrow to
 * `admin`-only and are audited.
 *
 * REAL — wires to the exported {@link PremiumService} via {@link AdminPremiumService}.
 */
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('moderator', 'admin')
@Controller('admin/premium')
export class AdminPremiumController {
  constructor(
    private readonly premiumService: AdminPremiumService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List subscribers (cursor-paginated) + active-entitlement count' })
  @ApiOkResponse({ description: 'A page of subscribers' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async list(@Query('cursor') cursor?: string): Promise<AdminPremiumList> {
    return this.premiumService.list(cursor);
  }

  @Post(':userId/grant')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ApiOperation({ summary: 'Grant N days of comp premium (admin-only; audited)' })
  @ApiParam({ name: 'userId', description: 'User id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'Premium granted' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  async grant(
    @Param('userId') userId: string,
    @Body(createZodValidationPipe(adminGrantPremiumSchema)) body: AdminGrantPremiumDto,
    @CurrentUser() caller: JwtPayload,
  ): Promise<{ ok: true }> {
    await this.premiumService.grant(userId, body.days);
    await this.auditService.log({
      actorId: caller.sub,
      action: 'premium.grant',
      targetType: 'user',
      targetId: userId,
      meta: { days: body.days },
    });
    return { ok: true };
  }

  @Post(':userId/revoke')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ApiOperation({ summary: 'Revoke premium (admin-only; audited)' })
  @ApiParam({ name: 'userId', description: 'User id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'Premium revoked' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  async revoke(
    @Param('userId') userId: string,
    @CurrentUser() caller: JwtPayload,
  ): Promise<{ ok: true }> {
    await this.premiumService.revoke(userId);
    await this.auditService.log({
      actorId: caller.sub,
      action: 'premium.revoke',
      targetType: 'user',
      targetId: userId,
    });
    return { ok: true };
  }
}
