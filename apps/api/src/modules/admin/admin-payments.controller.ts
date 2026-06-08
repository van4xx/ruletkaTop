import {
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

import type { AdminPaymentList, AdminPaymentStats, JwtPayload } from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';
import { AdminPaymentsService } from './admin-payments.service';
import { AuditService } from './audit.service';

/**
 * Admin payments surface, mounted under `/admin/payments`. Role-gated to
 * `moderator`/`admin`. REAL — reads the `payments` collection.
 */
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('moderator', 'admin')
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(
    private readonly paymentsService: AdminPaymentsService,
    private readonly auditService: AuditService,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: 'Revenue + status-funnel aggregates' })
  @ApiOkResponse({ description: 'Payment stats' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async stats(): Promise<AdminPaymentStats> {
    return this.paymentsService.getStats();
  }

  @Get()
  @ApiOperation({ summary: 'List charges (cursor-paginated, newest first)' })
  @ApiOkResponse({ description: 'A page of charges' })
  @ApiForbiddenResponse({ description: 'Caller is not a moderator/admin' })
  async list(@Query('cursor') cursor?: string): Promise<AdminPaymentList> {
    return this.paymentsService.list(cursor);
  }

  @Post(':paymentId/refund')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @ApiOperation({
    summary: 'Refund a completed charge via CloudPayments (admin-only; audited)',
    description:
      'Calls CloudPayments to refund the charge, then reverses fulfilment ' +
      '(debit coins / cancel premium) and marks the payment refunded.',
  })
  @ApiParam({ name: 'paymentId', description: 'Payment id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'Refund issued' })
  @ApiForbiddenResponse({ description: 'Caller is not an admin' })
  async refund(
    @Param('paymentId') paymentId: string,
    @CurrentUser() caller: JwtPayload,
  ): Promise<{ ok: true; amount: number; transactionId: number | null }> {
    const result = await this.paymentsService.refund(paymentId);
    await this.auditService.log({
      actorId: caller.sub,
      action: 'payment.refund',
      targetType: 'payment',
      targetId: paymentId,
      meta: { amount: result.amount, transactionId: result.transactionId },
    });
    return { ok: true, amount: result.amount, transactionId: result.transactionId };
  }
}
