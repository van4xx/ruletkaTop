import {
  Body,
  Controller,
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
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import {
  type AdminWalletAdjustDto,
  adminWalletAdjustSchema,
  type AdminWalletAdjustResult,
  type AdminWalletDetail,
  type AdminWalletStats,
  type JwtPayload,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import { AdminWalletService } from './admin-wallet.service';
import { AuditService } from './audit.service';

/**
 * Admin wallet surface, mounted under `/admin/wallet`. The read routes are
 * `moderator`/`admin`; the manual ADJUST route narrows to `admin`-only (it
 * mints/burns coins — a privileged money write) and is recorded in the audit log.
 *
 * REAL — wires to the exported {@link WalletService} via {@link AdminWalletService}.
 */
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('moderator', 'admin')
@Controller('admin/wallet')
export class AdminWalletController {
  constructor(
    private readonly walletService: AdminWalletService,
    private readonly auditService: AuditService,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: 'Economy-wide wallet aggregates (circulation, count, mean, max)' })
  @ApiOkResponse({ description: 'Wallet stats' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async stats(): Promise<AdminWalletStats> {
    return this.walletService.getStats();
  }

  @Get(':userId')
  @ApiOperation({ summary: 'A user balance + a page of their coin ledger' })
  @ApiParam({ name: 'userId', description: 'User id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'Balance + ledger page' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async detail(
    @Param('userId') userId: string,
    @Query('cursor') cursor?: string,
  ): Promise<AdminWalletDetail> {
    return this.walletService.getDetail(userId, cursor);
  }

  @Post(':userId/adjust')
  @HttpCode(HttpStatus.OK)
  @Roles('admin') // minting/burning coins is admin-ONLY
  @ApiOperation({ summary: 'Manually credit/debit a user (admin-only; audited)' })
  @ApiParam({ name: 'userId', description: 'User id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'New balance + applied delta' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  async adjust(
    @Param('userId') userId: string,
    @Body(createZodValidationPipe(adminWalletAdjustSchema)) body: AdminWalletAdjustDto,
    @CurrentUser() caller: JwtPayload,
  ): Promise<AdminWalletAdjustResult> {
    const result = await this.walletService.adjust(userId, body.amount, body.reason);
    await this.auditService.log({
      actorId: caller.sub,
      action: 'wallet.adjust',
      targetType: 'user',
      targetId: userId,
      meta: { amount: body.amount, reason: body.reason, balanceAfter: result.balanceCoins },
    });
    return result;
  }
}
