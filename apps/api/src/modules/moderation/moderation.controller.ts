import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import {
  type Block,
  type CreateBlockDto,
  createBlockSchema,
  type CreateReportDto,
  createReportSchema,
  type JwtPayload,
  type ModerationActionPayload,
  type ModerationViolationDto,
  moderationViolationSchema,
  type Report,
  type ReviewItem,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import { BlocksService } from './blocks.service';
import {
  type ListReportsQuery,
  listReportsQuerySchema,
  type ListReviewQuery,
  listReviewQuerySchema,
  type ResolveReportDto,
  resolveReportSchema,
  type ResolveReviewDto,
  resolveReviewSchema,
} from './moderation.contracts';
import { ModerationService } from './moderation.service';
import { type ReportPage, ReportsService } from './reports.service';
import { type ReviewPage, ReviewService } from './review.service';

/**
 * Moderation surface. All routes require a valid access token (class-level
 * {@link JwtAuthGuard}).
 *
 * USER routes act on behalf of the caller (`@CurrentUser().sub`): filing abuse
 * `reports` and managing user `blocks`.
 *
 * MODERATOR routes (`GET /reports`, `POST /reports/:id/resolve`) are additionally
 * gated by {@link RolesGuard} + `@Roles('moderator','admin')` — a regular user
 * receives `403`.
 */
@ApiTags('moderation')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller()
export class ModerationController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly blocksService: BlocksService,
    private readonly moderationService: ModerationService,
    private readonly reviewService: ReviewService,
  ) {}

  // ── Real-time AI moderation ──────────────────────────────────────────────────

  @Post('moderation/frame')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Report a frame violation detected by on-device screening; ' +
      'returns the forced action (warn/kick/ban) the escalation policy applied',
  })
  @ApiOkResponse({ description: 'The moderation action taken for this violation' })
  async reportFrame(
    @CurrentUser() user: JwtPayload,
    @Body(createZodValidationPipe(moderationViolationSchema)) dto: ModerationViolationDto,
  ): Promise<ModerationActionPayload> {
    return this.moderationService.handleViolation(user.sub, dto);
  }

  @Get('moderation/review')
  @UseGuards(RolesGuard)
  @Roles('moderator', 'admin')
  @ApiOperation({ summary: 'List AI-moderation review-queue items (moderator/admin)' })
  @ApiOkResponse({ description: 'Cursor-paginated review items, newest first' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async listReview(
    @Query(createZodValidationPipe(listReviewQuerySchema)) query: ListReviewQuery,
  ): Promise<ReviewPage> {
    return this.reviewService.listQueue(
      { cursor: query.cursor, limit: query.limit },
      query.status,
    );
  }

  @Post('moderation/review/:id/resolve')
  @UseGuards(RolesGuard)
  @Roles('moderator', 'admin')
  @ApiOperation({ summary: 'Uphold or dismiss a review item (moderator/admin)' })
  @ApiParam({ name: 'id', description: 'Moderation event id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'The updated review item' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async resolveReview(
    @Param('id') id: string,
    @Body(createZodValidationPipe(resolveReviewSchema)) dto: ResolveReviewDto,
  ): Promise<ReviewItem> {
    return this.reviewService.resolve(id, dto.status);
  }

  // ── Moderator triage (role-guarded) ─────────────────────────────────────────

  @Get('reports')
  @UseGuards(RolesGuard)
  @Roles('moderator', 'admin')
  @ApiOperation({ summary: 'List abuse reports for triage (moderator/admin)' })
  @ApiOkResponse({ description: 'Cursor-paginated reports, newest first' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async listReports(
    @Query(createZodValidationPipe(listReportsQuerySchema)) query: ListReportsQuery,
  ): Promise<ReportPage> {
    return this.reportsService.listReports(
      { cursor: query.cursor, limit: query.limit },
      query.status,
    );
  }

  @Post('reports/:id/resolve')
  @UseGuards(RolesGuard)
  @Roles('moderator', 'admin')
  @ApiOperation({ summary: 'Resolve or dismiss a report (moderator/admin)' })
  @ApiParam({ name: 'id', description: 'Report id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'The updated report' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async resolveReport(
    @Param('id') id: string,
    @Body(createZodValidationPipe(resolveReportSchema)) dto: ResolveReportDto,
  ): Promise<Report> {
    return this.reportsService.resolveReport(id, dto.status);
  }

  // ── User surface ─────────────────────────────────────────────────────────────

  @Post('reports')
  @ApiOperation({ summary: 'File an abuse report against another user' })
  @ApiCreatedResponse({ description: 'The created report (status: open)' })
  async createReport(
    @CurrentUser() user: JwtPayload,
    @Body(createZodValidationPipe(createReportSchema)) dto: CreateReportDto,
  ): Promise<Report> {
    return this.reportsService.createReport(user.sub, dto);
  }

  @Post('blocks')
  @ApiOperation({ summary: 'Block another user' })
  @ApiCreatedResponse({ description: 'The created block' })
  async createBlock(
    @CurrentUser() user: JwtPayload,
    @Body(createZodValidationPipe(createBlockSchema)) dto: CreateBlockDto,
  ): Promise<Block> {
    return this.blocksService.createBlock(user.sub, dto);
  }

  @Get('blocks')
  @ApiOperation({ summary: 'List users the caller has blocked (newest first)' })
  @ApiOkResponse({ description: 'Blocks owned by the caller' })
  async listBlocks(@CurrentUser() user: JwtPayload): Promise<Block[]> {
    return this.blocksService.listOwnBlocks(user.sub);
  }

  @Delete('blocks/:blockedUserId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unblock a user (idempotent)' })
  @ApiParam({ name: 'blockedUserId', description: 'Blocked user id (Mongo ObjectId)' })
  @ApiNoContentResponse({ description: 'Block removed (or did not exist)' })
  async removeBlock(
    @CurrentUser() user: JwtPayload,
    @Param('blockedUserId') blockedUserId: string,
  ): Promise<void> {
    await this.blocksService.removeBlock(user.sub, blockedUserId);
  }
}
