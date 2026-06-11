import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { CloudPaymentsClient } from '../payments/cloudpayments.client';
import { PremiumController } from './premium.controller';
import { PremiumService } from './premium.service';
import { PremiumTierGuard } from './premium-tier.guard';
import { PremiumPlan, PremiumPlanSchema } from './schemas/premium-plan.schema';
import { Subscription, SubscriptionSchema } from './schemas/subscription.schema';
import {
  SUBSCRIPTION_SWEEP_QUEUE,
  SubscriptionSweepProcessor,
} from './subscription-sweep.processor';

/**
 * Owns the `premiumplans` catalogue and the `subscriptions` collection, plus
 * the `/premium` REST surface.
 *
 * Exports {@link PremiumService} (`isPremium` / `activate` / `cancel` /
 * `findPlanByCode`), consumed by `gifts` (premium-only gating), `matchmaking`
 * (premium filters) and `payments` (webhook activation). The integrator binds
 * it to the payments-side `PREMIUM_SERVICE` token via `useExisting`.
 *
 * Activation mirrors `isPremium`/`premiumUntil`/`badges` onto the `profiles`
 * collection by name (no `ProfilesModule` import — see {@link PremiumService}).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PremiumPlan.name, schema: PremiumPlanSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
    ]),
    // Background expiry sweep (BullMQ). The root connection lives in AppModule;
    // here we just register the named queue this module's processor drains.
    BullModule.registerQueue({ name: SUBSCRIPTION_SWEEP_QUEUE }),
  ],
  controllers: [PremiumController],
  providers: [
    PremiumService,
    SubscriptionSweepProcessor,
    // The tier guard reads `@RequiresPremiumTier()` metadata and consults
    // {@link PremiumService.hasTierOrAbove}; exported so any module gating
    // a route on tier can `imports: [PremiumModule]` and `@UseGuards(...)`
    // it without a duplicated provider.
    PremiumTierGuard,
    // The outbound CloudPayments client is `ConfigService`-only (no DB/state),
    // so we provide it directly here for the user-initiated cancel path rather
    // than importing PaymentsModule (which imports PremiumModule — would cycle).
    CloudPaymentsClient,
  ],
  exports: [PremiumService, PremiumTierGuard, MongooseModule],
})
export class PremiumModule {}
