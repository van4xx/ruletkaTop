import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  type AdminBroadcastDto,
  adminBroadcastSchema,
  type AdminBroadcastHistory,
  type AdminBroadcastResult,
  type JwtPayload,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import { AdminBroadcastService } from './admin-broadcast.service';
import { AuditService } from './audit.service';

/**
 * Admin broadcast surface, mounted under `/admin/broadcast`. The send is
 * `admin`-only (it messages many users at once) and audited; history is
 * `moderator`/`admin`.
 *
 * Send is REAL (fans out via NotificationsService + persists a history record);
 * history is REAL (reads the `broadcasts` collection, newest first).
 */
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('moderator', 'admin')
@Controller('admin/broadcast')
export class AdminBroadcastController {
  constructor(
    private readonly broadcastService: AdminBroadcastService,
    private readonly auditService: AuditService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ApiOperation({ summary: 'Fan out a system notification to a segment (admin-only; audited)' })
  @ApiOkResponse({ description: 'Broadcast id + recipient count' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  async send(
    @Body(createZodValidationPipe(adminBroadcastSchema)) body: AdminBroadcastDto,
    @CurrentUser() caller: JwtPayload,
  ): Promise<AdminBroadcastResult> {
    const result = await this.broadcastService.send(body, caller.sub);
    await this.auditService.log({
      actorId: caller.sub,
      action: 'broadcast.send',
      targetType: 'segment',
      targetId: body.segment,
      meta: { title: body.title, segment: body.segment, recipients: result.recipients },
    });
    return result;
  }

  @Get()
  @ApiOperation({ summary: 'Broadcast history (STUB — empty until wave2)' })
  @ApiOkResponse({ description: 'Broadcast history' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async history(): Promise<AdminBroadcastHistory> {
    return this.broadcastService.history();
  }
}
