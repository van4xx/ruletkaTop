import { Module } from '@nestjs/common';

import { LeaderboardController } from './leaderboard.controller';
import { LeaderboardService } from './leaderboard.service';

/**
 * Read-only leaderboard surface under `/leaderboard`.
 *
 * Owns NO collection: {@link LeaderboardService} aggregates entirely from
 * EXISTING collections read by name via the shared Mongoose connection
 * (`gifttransactions`, `wallets`, `topplacements`, joined to `profiles`), so
 * this module registers no `forFeature` schema and takes no dependency on the
 * economy / profile modules. The shared connection is provided by the global
 * `MongooseModule` root.
 */
@Module({
  controllers: [LeaderboardController],
  providers: [LeaderboardService],
})
export class LeaderboardModule {}
