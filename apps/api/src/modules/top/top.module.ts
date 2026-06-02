import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { WalletModule } from '../wallet/wallet.module';
import { TopPlacement, TopPlacementSchema } from './schemas/top-placement.schema';
import { TopController } from './top.controller';
import { TopService } from './top.service';

/**
 * Owns the `topplacements` collection and the `/top` REST surface.
 *
 * Imports {@link WalletModule} to atomically debit buyers via
 * {@link WalletService} (ledger type `top`). Exports {@link TopService} for any
 * future consumer (e.g. a matchmaking boost or admin tooling).
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: TopPlacement.name, schema: TopPlacementSchema }]),
    WalletModule,
  ],
  controllers: [TopController],
  providers: [TopService],
  exports: [TopService, MongooseModule],
})
export class TopModule {}
