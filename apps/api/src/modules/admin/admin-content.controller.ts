import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';

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
 * `PATCH /admin/content/announcements/:id` body — a partial edit (toggle active
 * and/or change copy). Local DTO (no shared schema yet): at least one field
 * required so an empty PATCH is rejected.
 */
const updateAnnouncementSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    body: z.string().trim().min(1).max(2000).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => v.title !== undefined || v.body !== undefined || v.active !== undefined, {
    message: 'Provide at least one field to update',
  });
type UpdateAnnouncementDto = z.infer<typeof updateAnnouncementSchema>;

/**
 * Admin content surface, mounted under `/admin/content`. Role-gated to
 * `moderator`/`admin`; announcement create/edit/delete narrow to `admin`-only.
 *
 * REAL: `GET /covers` (catalogue + ownership counts) and the full announcements
 * CRUD (persisted in the `announcements` collection — WAVE-2). Mutations are
 * audited.
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
  @ApiOperation({ summary: 'List announcements (newest first)' })
  @ApiOkResponse({ description: 'Announcement list' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async announcements(): Promise<AdminAnnouncementList> {
    return this.contentService.listAnnouncements();
  }

  @Post('announcements')
  @Roles('admin')
  @ApiOperation({ summary: 'Create an announcement (admin-only; audited)' })
  @ApiOkResponse({ description: 'The created announcement' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  async createAnnouncement(
    @Body(createZodValidationPipe(adminCreateAnnouncementSchema)) body: AdminCreateAnnouncementDto,
    @CurrentUser() caller: JwtPayload,
  ): Promise<AdminAnnouncement> {
    const created = await this.contentService.createAnnouncement(body, caller.sub);
    await this.auditService.log({
      actorId: caller.sub,
      action: 'content.announcement.create',
      targetType: 'announcement',
      targetId: created.id,
      meta: { title: body.title, active: body.active },
    });
    return created;
  }

  @Patch('announcements/:id')
  @Roles('admin')
  @ApiOperation({ summary: 'Edit / toggle an announcement (admin-only; audited)' })
  @ApiOkResponse({ description: 'The updated announcement' })
  @ApiNotFoundResponse({ description: 'Announcement not found' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  async updateAnnouncement(
    @Param('id') id: string,
    @Body(createZodValidationPipe(updateAnnouncementSchema)) body: UpdateAnnouncementDto,
    @CurrentUser() caller: JwtPayload,
  ): Promise<AdminAnnouncement> {
    const updated = await this.contentService.updateAnnouncement(id, body);
    await this.auditService.log({
      actorId: caller.sub,
      action: 'content.announcement.update',
      targetType: 'announcement',
      targetId: id,
      meta: { ...body },
    });
    return updated;
  }

  @Delete('announcements/:id')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an announcement (admin-only; audited)' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ description: 'Announcement not found' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  async deleteAnnouncement(
    @Param('id') id: string,
    @CurrentUser() caller: JwtPayload,
  ): Promise<void> {
    await this.contentService.deleteAnnouncement(id);
    await this.auditService.log({
      actorId: caller.sub,
      action: 'content.announcement.delete',
      targetType: 'announcement',
      targetId: id,
    });
  }
}
