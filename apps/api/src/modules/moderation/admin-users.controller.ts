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
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import {
  type AdminUserList,
  type AdminUserListQuery,
  adminUserListQuerySchema,
  type AdminUserSummary,
  type JwtPayload,
  type SetUserRoleDto,
  setUserRoleSchema,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import { AdminUsersService } from './admin-users.service';

/**
 * Admin user-management surface, mounted under `/admin/users`. Class-level
 * {@link JwtAuthGuard} + {@link RolesGuard} + {@link Roles} require a valid
 * access token AND the `moderator`/`admin` role (a regular user gets `403`),
 * matching {@link AdminController}.
 *
 * The role-change route NARROWS the gate to `admin` only via a method-level
 * `@Roles('admin')` (which the {@link RolesGuard} reads handler-first via
 * `getAllAndOverride`), so a moderator can browse users but cannot change roles.
 */
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('moderator', 'admin')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  @ApiOperation({
    summary: 'List users (text search on email/nickname, role + banned filters, cursor-paginated)',
  })
  @ApiOkResponse({ description: 'A page of user summaries + pagination cursor' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async list(
    @Query(createZodValidationPipe(adminUserListQuerySchema)) query: AdminUserListQuery,
  ): Promise<AdminUserList> {
    return this.adminUsersService.listUsers(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a single user summary' })
  @ApiParam({ name: 'id', description: 'User id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'The user summary' })
  @ApiNotFoundResponse({ description: 'No such user' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async getOne(@Param('id') id: string): Promise<AdminUserSummary> {
    return this.adminUsersService.getUser(id);
  }

  @Post(':id/role')
  @HttpCode(HttpStatus.OK)
  @Roles('admin') // narrows the class gate: role changes are admin-ONLY
  @ApiOperation({
    summary: 'Set a user role (admin-only; revokes sessions on a demotion)',
  })
  @ApiParam({ name: 'id', description: 'User id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'The updated user summary' })
  @ApiNotFoundResponse({ description: 'No such user' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  async setRole(
    @Param('id') id: string,
    @Body(createZodValidationPipe(setUserRoleSchema)) body: SetUserRoleDto,
    @CurrentUser() caller: JwtPayload,
  ): Promise<AdminUserSummary> {
    return this.adminUsersService.setRole(id, body.role, caller.role, caller.sub);
  }

  @Post(':id/verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Force-confirm a user's email (admin override of the emailed link; idempotent)",
  })
  @ApiParam({ name: 'id', description: 'User id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'The updated user summary (emailVerified=true)' })
  @ApiNotFoundResponse({ description: 'No such user' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async verifyEmail(
    @Param('id') id: string,
    @CurrentUser() caller: JwtPayload,
  ): Promise<AdminUserSummary> {
    return this.adminUsersService.verifyEmail(id, caller.sub);
  }

  @Post(':id/force-logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Force-logout: revoke ALL of the user's refresh sessions (logout-everywhere)",
  })
  @ApiParam({ name: 'id', description: 'User id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'Acknowledgement that sessions were revoked' })
  @ApiNotFoundResponse({ description: 'No such user' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async forceLogout(
    @Param('id') id: string,
    @CurrentUser() caller: JwtPayload,
  ): Promise<{ ok: true }> {
    return this.adminUsersService.forceLogout(id, caller.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles('admin') // narrows the class gate: account deletion is admin-ONLY
  @ApiOperation({
    summary: 'Delete (anonymize + tombstone) a user account, admin-only',
  })
  @ApiParam({ name: 'id', description: 'User id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'Acknowledgement that the account was deleted' })
  @ApiNotFoundResponse({ description: 'No such user (or already deleted)' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  async deleteUser(
    @Param('id') id: string,
    @CurrentUser() caller: JwtPayload,
  ): Promise<{ ok: true }> {
    return this.adminUsersService.deleteUser(id, caller.sub);
  }
}
