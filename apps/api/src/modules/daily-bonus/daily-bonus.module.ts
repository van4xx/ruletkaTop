import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { PremiumModule } from '../premium/premium.module';
import { WalletModule } from '../wallet/wallet.module';
import { DailyBonusController } from './daily-bonus.controller';
import { DailyBonusService } from './daily-bonus.service';
import { DailyBonus, DailyBonusSchema } from './schemas/daily-bonus.schema';

/**
 * Owns the `dailybonuses` collection and the `/economy/daily-bonus` REST
 * surface (state + claim).
 *
 * Imports {@link WalletModule} to atomically credit claims through
 * {@link WalletService} as ledger type `bonus` — the wallet's partial-unique
 * `(type, refId)` index supplies the idempotency that makes a duplicated
 * claim (network retry, double-tap) a clean no-op rather than a double credit.
 *
 * Exports {@link DailyBonusService} so other modules can read state without
 * re-importing this module's schema (none currently do, but the door is open).
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: DailyBonus.name, schema: DailyBonusSchema }]),
    WalletModule,
    // Daily-bonus reads the caller's tier at credit time so the multiplier
    // (Lite 1.5x / Pro 2x) is applied authoritatively from a single source.
    PremiumModule,
  ],
  controllers: [DailyBonusController],
  providers: [DailyBonusService],
  exports: [DailyBonusService, MongooseModule],
})
export class DailyBonusModule {}
