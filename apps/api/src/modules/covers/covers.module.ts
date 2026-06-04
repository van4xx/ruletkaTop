import { Module } from '@nestjs/common';

import { ProfilesModule } from '../profiles/profiles.module';
import { WalletModule } from '../wallet/wallet.module';
import { CoversController } from './covers.controller';
import { CoversService } from './covers.service';

/**
 * Owns the `/covers` REST surface and the profile-cover cosmetic flow.
 *
 * The cover CATALOGUE is code-defined in `@ruletka/shared-types`
 * (`COVER_CATALOGUE`) — covers are render-bound to client presets, so there is
 * no DB collection (unlike `gifts`). Ownership/active state lives on the
 * `profiles` collection (`ownedCovers` / `activeCover`), which is why this module
 * imports {@link ProfilesModule} (for {@link ProfilesService} AND the re-exported
 * `Profile` Mongoose model — registered there exactly once) rather than
 * re-registering the schema.
 *
 * Imports {@link WalletModule} to atomically DEBIT a buyer via
 * {@link WalletService} (ledger type `cover`), mirroring `gifts`/`top`.
 */
@Module({
  imports: [ProfilesModule, WalletModule],
  controllers: [CoversController],
  providers: [CoversService],
  exports: [CoversService],
})
export class CoversModule {}
