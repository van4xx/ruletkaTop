import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { PremiumModule } from '../premium/premium.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { WalletModule } from '../wallet/wallet.module';
import { ReferralRewardProcessor, REFERRAL_REWARD_QUEUE } from './referral-reward.processor';
import { ReferralsController, ReferralsPublicController } from './referrals.controller';
import { ReferralsService } from './referrals.service';
import { ReferralCursor, ReferralCursorSchema } from './schemas/referral-cursor.schema';
import { ReferralEdge, ReferralEdgeSchema } from './schemas/referral-edge.schema';
import { ReferralLink, ReferralLinkSchema } from './schemas/referral-link.schema';

/**
 * Owns the `referrallinks`, `referraledges` and `referralcursors` collections
 * and the public `/referrals` REST surface.
 *
 * ── Dependencies ──────────────────────────────────────────────────────────
 * - {@link WalletModule}    — credits inviter rewards via `WalletService.credit`
 *   (`type: 'referral'`, namespaced refId) so the wallet's idempotency makes a
 *   redelivered sweep a clean no-op.
 * - {@link ProfilesModule}  — read-only access to `Profile` to hydrate inviter
 *   nicknames (public lookup) and the downline list's invitee avatars/nicknames.
 *   Profiles module re-exports `MongooseModule`, so we inject the model directly
 *   rather than calling a service.
 * - `CoinTransaction` model — re-exported by WalletModule; consumed for the
 *   sweep cursor scan AND for the per-tier earnings aggregate in `/me/stats`.
 *
 * ── Background worker ─────────────────────────────────────────────────────
 * {@link ReferralRewardProcessor} drains the `referral-reward-sweep` BullMQ
 * queue. The root BullMQ connection lives in `AppModule`; here we just declare
 * the named queue. The repeatable schedule (every 60s) is registered in
 * `onModuleInit` so it self-installs on boot and is idempotent across replicas
 * via a stable `jobId`.
 *
 * NOTE: NO touch points on wallet, auth, profiles, or payments core logic. The
 * coupling is read-only (models) + the cross-module {@link WalletService}
 * credit primitive that's already exported and used by daily-bonus / payments.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ReferralLink.name, schema: ReferralLinkSchema },
      { name: ReferralEdge.name, schema: ReferralEdgeSchema },
      { name: ReferralCursor.name, schema: ReferralCursorSchema },
    ]),
    // Wallet re-exports `MongooseModule` (with `CoinTransaction` registered) +
    // `WalletService` (credit / debit / getBalance). We use BOTH here: the
    // model for the sweep's `_id`-keyed scan, the service for the inviter credit.
    WalletModule,
    // Profiles re-exports `MongooseModule` (with `Profile` registered). Read-only
    // use for inviter nickname (lookup) + invitee profile hydration (downline).
    ProfilesModule,
    // The tier-aware referral lifetime cap (`lifetimeReferralCapFor`) is
    // applied inside the credit loop — Pro inviters get a higher ceiling.
    PremiumModule,
    // The BullMQ root connection lives in AppModule; we just register the named
    // queue this module's processor drains.
    BullModule.registerQueue({ name: REFERRAL_REWARD_QUEUE }),
  ],
  controllers: [ReferralsController, ReferralsPublicController],
  providers: [ReferralsService, ReferralRewardProcessor],
  // Export the service so a future cross-module integration (e.g. an auth-side
  // direct bind call) can `imports: [ReferralsModule]` and DI inject it.
  exports: [ReferralsService, MongooseModule],
})
export class ReferralsModule {}
