import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { CoinPackagesService } from '../wallet/coin-packages.service';
import { WalletModule } from '../wallet/wallet.module';
import { WalletService } from '../wallet/wallet.service';
import { PremiumModule } from '../premium/premium.module';
import { PremiumService } from '../premium/premium.service';
import { CloudPaymentsClient } from './cloudpayments.client';
import { CloudPaymentsSignatureGuard } from './cloudpayments-signature.guard';
import { COIN_PACKAGES_SERVICE, PREMIUM_SERVICE, WALLET_SERVICE } from './payments.contracts';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';

/**
 * CloudPayments integration: the authenticated coins checkout and the
 * HMAC-verified, idempotent provider webhooks.
 *
 * Owns the `payments` collection (audit + idempotency ledger). Fulfilment is
 * delegated to the economy services through the contract tokens, which are
 * bound here to the concrete providers via `useExisting` (importing
 * {@link WalletModule} and {@link PremiumModule} so those exported providers
 * resolve):
 *  - {@link WALLET_SERVICE}         → {@link WalletService}
 *  - {@link PREMIUM_SERVICE}        → {@link PremiumService}
 *  - {@link COIN_PACKAGES_SERVICE}  → {@link CoinPackagesService}
 *
 * No service is exported — payments is a terminal consumer. The integrator only
 * needs to register this module in {@link AppModule} (the guard reads the raw
 * body which `main.ts` already enables via `rawBody: true`, and pulls
 * `CLOUDPAYMENTS_PUBLIC_ID` / `CLOUDPAYMENTS_API_SECRET` from env).
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Payment.name, schema: PaymentSchema }]),
    WalletModule,
    PremiumModule,
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    CloudPaymentsClient,
    CloudPaymentsSignatureGuard,
    // Bind the cross-module contract tokens to the real economy services.
    { provide: WALLET_SERVICE, useExisting: WalletService },
    { provide: PREMIUM_SERVICE, useExisting: PremiumService },
    { provide: COIN_PACKAGES_SERVICE, useExisting: CoinPackagesService },
  ],
  // Export the outbound REST client + PaymentsService so the admin refund
  // surface can drive an authoritative refund (CloudPayments call + ledger
  // reversal) through the same code path the webhook uses. AdminModule imports
  // PaymentsModule for this; no cycle (payments never imports admin).
  exports: [CloudPaymentsClient, PaymentsService],
})
export class PaymentsModule {}
