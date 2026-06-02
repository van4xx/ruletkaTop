import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  type CheckoutWidgetParams,
  type CloudPaymentsAck,
  type CloudPaymentsNotification,
  cloudPaymentsNotificationSchema,
  type CoinsCheckoutDto,
  coinsCheckoutSchema,
  type JwtPayload,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import { CloudPaymentsSignatureGuard } from './cloudpayments-signature.guard';
import { PaymentsService } from './payments.service';

/**
 * Validates CloudPayments webhook bodies. CloudPayments POSTs
 * `application/x-www-form-urlencoded` with PascalCase keys; Express's urlencoded
 * parser yields a flat string map which `cloudPaymentsNotificationSchema`
 * coerces (`TransactionId`/`Amount` → numbers). The RAW bytes are HMAC-verified
 * separately by {@link CloudPaymentsSignatureGuard} (reads `req.rawBody`).
 */
const notificationPipe = createZodValidationPipe(cloudPaymentsNotificationSchema);

/**
 * Payments surface for CloudPayments.
 *
 * - `POST /payments/coins/checkout` (authenticated): begin a coin purchase and
 *   receive the widget params. Amount is fixed server-side from the package.
 * - `POST /payments/cloudpayments/{check,pay,fail,confirm,recurrent,refund}`
 *   (PUBLIC): provider webhooks. These are NOT behind the JWT guard — they are
 *   authenticated by {@link CloudPaymentsSignatureGuard}, which HMAC-verifies the
 *   raw request body against `CLOUDPAYMENTS_API_SECRET`. Every handler is
 *   idempotent and returns the CloudPayments ack `{ code: 0 }` on success.
 */
@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // ── Checkout (authenticated) ───────────────────────────────────────────────

  @Post('coins/checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Start a coins purchase and get CloudPayments widget params',
    description:
      'Resolves the coin package server-side, creates a PENDING payment with a ' +
      'unique invoiceId, and returns the params to open the CloudPayments ' +
      'widget. The amount is fixed from the package price — client amounts are ' +
      'never trusted.',
  })
  @ApiCreatedResponse({ description: 'Widget params for the CloudPayments SDK' })
  async coinsCheckout(
    @CurrentUser() user: JwtPayload,
    @Body(createZodValidationPipe(coinsCheckoutSchema)) dto: CoinsCheckoutDto,
  ): Promise<CheckoutWidgetParams> {
    return this.paymentsService.createCoinsCheckout(user.sub, dto);
  }

  // ── Webhooks (public; HMAC-verified) ────────────────────────────────────────

  @Post('cloudpayments/check')
  @UseGuards(CloudPaymentsSignatureGuard)
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async check(
    @Body(notificationPipe) body: CloudPaymentsNotification,
  ): Promise<CloudPaymentsAck> {
    return this.paymentsService.handleCheck(body);
  }

  @Post('cloudpayments/pay')
  @UseGuards(CloudPaymentsSignatureGuard)
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async pay(
    @Body(notificationPipe) body: CloudPaymentsNotification,
  ): Promise<CloudPaymentsAck> {
    return this.paymentsService.handlePay(body);
  }

  @Post('cloudpayments/fail')
  @UseGuards(CloudPaymentsSignatureGuard)
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async fail(
    @Body(notificationPipe) body: CloudPaymentsNotification,
  ): Promise<CloudPaymentsAck> {
    return this.paymentsService.handleFail(body);
  }

  @Post('cloudpayments/confirm')
  @UseGuards(CloudPaymentsSignatureGuard)
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async confirm(
    @Body(notificationPipe) body: CloudPaymentsNotification,
  ): Promise<CloudPaymentsAck> {
    return this.paymentsService.handleConfirm(body);
  }

  @Post('cloudpayments/recurrent')
  @UseGuards(CloudPaymentsSignatureGuard)
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async recurrent(
    @Body(notificationPipe) body: CloudPaymentsNotification,
  ): Promise<CloudPaymentsAck> {
    return this.paymentsService.handleRecurrent(body);
  }

  @Post('cloudpayments/refund')
  @UseGuards(CloudPaymentsSignatureGuard)
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async refund(
    @Body(notificationPipe) body: CloudPaymentsNotification,
  ): Promise<CloudPaymentsAck> {
    return this.paymentsService.handleRefund(body);
  }
}
