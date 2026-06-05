import {
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
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';
import {
  type AdminPage,
  AdminService,
  type BannedFingerprintRow,
  type BannedUserRow,
  type BanResult,
} from './admin.service';

/** Clamp a raw `limit` query param to the shared 1..100 bound (default 20). */
function parseLimit(raw?: string): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) {
    return 20;
  }
  return Math.min(100, Math.max(1, n));
}

/**
 * Administrative account actions, mounted under `/admin`. Every route requires a
 * valid access token AND the `moderator`/`admin` role (class-level
 * {@link JwtAuthGuard} + {@link RolesGuard} + {@link Roles}); a regular user gets
 * `403`.
 */
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('moderator', 'admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('users/:id/ban')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ban a user (sets isBanned, revokes sessions, drops live sockets)',
  })
  @ApiParam({ name: 'id', description: 'User id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'The user ban state after the operation' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async ban(@Param('id') id: string): Promise<BanResult> {
    return this.adminService.banUser(id);
  }

  @Post('users/:id/unban')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unban a user (clears isBanned)' })
  @ApiParam({ name: 'id', description: 'User id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'The user ban state after the operation' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async unban(@Param('id') id: string): Promise<BanResult> {
    return this.adminService.unbanUser(id);
  }

  // ── Ban-list reads (moderation console) ──────────────────────────────────────

  @Get('banned-users')
  @ApiOperation({
    summary: 'List currently-banned accounts (isBanned=true), cursor-paginated',
  })
  @ApiQuery({ name: 'cursor', required: false, description: 'Last _id from the previous page' })
  @ApiQuery({ name: 'limit', required: false, description: '1..100 (default 20)' })
  @ApiOkResponse({ description: 'A page of banned users + pagination cursor' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async bannedUsers(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<AdminPage<BannedUserRow>> {
    return this.adminService.listBannedUsers({ cursor: cursor || undefined, limit: parseLimit(limit) });
  }

  @Get('banned-fingerprints')
  @ApiOperation({
    summary: 'List ban-evasion fingerprints (hash/userId/expiry), cursor-paginated',
  })
  @ApiQuery({ name: 'cursor', required: false, description: 'Last _id from the previous page' })
  @ApiQuery({ name: 'limit', required: false, description: '1..100 (default 20)' })
  @ApiOkResponse({ description: 'A page of banned fingerprints + pagination cursor' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async bannedFingerprints(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<AdminPage<BannedFingerprintRow>> {
    return this.adminService.listBannedFingerprints({
      cursor: cursor || undefined,
      limit: parseLimit(limit),
    });
  }

  @Delete('banned-fingerprints/:id')
  @HttpCode(HttpStatus.OK)
  @Roles('admin') // narrows the class gate: lifting a fingerprint ban is admin-ONLY
  @ApiOperation({ summary: 'Lift (delete) one ban-evasion fingerprint (admin-only)' })
  @ApiParam({ name: 'id', description: 'Banned-fingerprint row id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'The lifted fingerprint id' })
  @ApiNotFoundResponse({ description: 'No such fingerprint row' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  async liftFingerprint(@Param('id') id: string): Promise<{ id: string; deleted: true }> {
    return this.adminService.liftFingerprint(id);
  }
}
