import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ModerationModule } from '../moderation/moderation.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PremiumModule } from '../premium/premium.module';
import { WalletModule } from '../wallet/wallet.module';
import { GiftsController } from './gifts.controller';
import { GiftsService } from './gifts.service';
import { GiftTransaction, GiftTransactionSchema } from './schemas/gift-transaction.schema';
import { Gift, GiftSchema } from './schemas/gift.schema';

/**
 * Owns the `gifts` catalogue and the `gifttransactions` ledger, plus the
 * `/gifts` REST surface.
 *
 * Imports {@link WalletModule} (to atomically debit senders via
 * {@link WalletService}, ledger type `gift_out`), {@link PremiumModule} (to
 * gate `isPremiumOnly` gifts via {@link PremiumService}) and
 * {@link ModerationModule} ({@link BlocksService} — gifts respect the block
 * relationship in both directions) and {@link NotificationsModule} (a received
 * gift raises a `gift` notification via the exported {@link NotificationsService}).
 * Exports {@link GiftsService} and the Mongoose models for reuse (e.g.
 * profile-side read of received gifts is by collection name and needs no import).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Gift.name, schema: GiftSchema },
      { name: GiftTransaction.name, schema: GiftTransactionSchema },
    ]),
    WalletModule,
    PremiumModule,
    ModerationModule,
    NotificationsModule,
  ],
  controllers: [GiftsController],
  providers: [GiftsService],
  exports: [GiftsService, MongooseModule],
})
export class GiftsModule {}
