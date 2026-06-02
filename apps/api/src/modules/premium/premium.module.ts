import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { PremiumController } from './premium.controller';
import { PremiumService } from './premium.service';
import { PremiumPlan, PremiumPlanSchema } from './schemas/premium-plan.schema';
import { Subscription, SubscriptionSchema } from './schemas/subscription.schema';

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
  ],
  controllers: [PremiumController],
  providers: [PremiumService],
  exports: [PremiumService, MongooseModule],
})
export class PremiumModule {}
