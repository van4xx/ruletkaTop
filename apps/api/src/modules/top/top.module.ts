import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { WalletModule } from '../wallet/wallet.module';
import { TopPlacement, TopPlacementSchema } from './schemas/top-placement.schema';
import { TopController } from './top.controller';
import { TOP_SWEEP_QUEUE, TopSweepProcessor } from './top-sweep.processor';
import { TopService } from './top.service';

/**
 * Owns the `topplacements` collection and the `/top` REST surface.
 *
 * Imports {@link WalletModule} to atomically debit buyers via
 * {@link WalletService} (ledger type `top`). Exports {@link TopService} for any
 * future consumer (e.g. a matchmaking boost or admin tooling).
 *
 * Also runs a background expiry sweep ({@link TopSweepProcessor}) that marks
 * past-window placements `expired` so the collection cannot grow an unbounded
 * backlog of dead rows. The BullMQ root connection lives in AppModule; here we
 * just register the named queue this module's processor drains.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: TopPlacement.name, schema: TopPlacementSchema }]),
    WalletModule,
    BullModule.registerQueue({ name: TOP_SWEEP_QUEUE }),
  ],
  controllers: [TopController],
  providers: [TopService, TopSweepProcessor],
  exports: [TopService, MongooseModule],
})
export class TopModule {}
