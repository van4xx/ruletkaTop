import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  type AdminAuditList,
  type AdminAuditQuery,
  adminAuditQuerySchema,
} from '@ruletka/shared-types';

import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuditService } from './audit.service';

/**
 * Admin audit trail, mounted under `/admin/audit`. Role-gated to
 * `moderator`/`admin` (class-level {@link JwtAuthGuard} + {@link RolesGuard} +
 * {@link Roles}), matching the existing admin controllers.
 *
 * REAL: backed by the `admin_audit_logs` collection via {@link AuditService}.
 * Wave-2 action endpoints append rows by calling `AuditService.log(...)`.
 */
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('moderator', 'admin')
@Controller('admin/audit')
export class AdminAuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'List audit-log entries (newest first, optional action filter)' })
  @ApiOkResponse({ description: 'A page of audit entries + pagination cursor' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async list(
    @Query(createZodValidationPipe(adminAuditQuerySchema)) query: AdminAuditQuery,
  ): Promise<AdminAuditList> {
    return this.auditService.list(query);
  }
}
