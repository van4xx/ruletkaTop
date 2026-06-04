import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  type AdminAnnouncement,
  type AdminAnnouncementList,
  type AdminCoverList,
  type AdminCreateAnnouncementDto,
  adminCreateAnnouncementSchema,
  type JwtPayload,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import { AdminContentService } from './admin-content.service';
import { AuditService } from './audit.service';

/**
 * Admin content surface, mounted under `/admin/content`. Role-gated to
 * `moderator`/`admin`; announcement create narrows to `admin`-only.
 *
 * REAL: `GET /covers` (catalogue + ownership counts).
 * STUB: announcements CRUD (no collection yet). // TODO(wave2)
 */
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('moderator', 'admin')
@Controller('admin/content')
export class AdminContentController {
  constructor(
    private readonly contentService: AdminContentService,
    private readonly auditService: AuditService,
  ) {}

  @Get('covers')
  @ApiOperation({ summary: 'Cover catalogue with live ownership counts' })
  @ApiOkResponse({ description: 'Covers + ownership analytics' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async covers(): Promise<AdminCoverList> {
    return this.contentService.listCovers();
  }

  @Get('announcements')
  @ApiOperation({ summary: 'List announcements (STUB — empty until wave2)' })
  @ApiOkResponse({ description: 'Announcement list' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async announcements(): Promise<AdminAnnouncementList> {
    return this.contentService.listAnnouncements();
  }

  @Post('announcements')
  @Roles('admin')
  @ApiOperation({ summary: 'Create an announcement (STUB — not persisted yet; admin-only; audited)' })
  @ApiOkResponse({ description: 'The (synthesized) announcement' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  async createAnnouncement(
    @Body(createZodValidationPipe(adminCreateAnnouncementSchema)) body: AdminCreateAnnouncementDto,
    @CurrentUser() caller: JwtPayload,
  ): Promise<AdminAnnouncement> {
    const created = await this.contentService.createAnnouncement(body);
    await this.auditService.log({
      actorId: caller.sub,
      action: 'content.announcement.create',
      targetType: 'announcement',
      targetId: created.id,
      meta: { title: body.title, active: body.active },
    });
    return created;
  }
}
