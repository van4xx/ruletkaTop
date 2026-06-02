import { Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';
import { AdminService, type BanResult } from './admin.service';

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
}
