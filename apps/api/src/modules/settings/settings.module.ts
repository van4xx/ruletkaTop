import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Settings, SettingsSchema } from './schemas/settings.schema';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * Owns the `settings` collection and the authenticated `/settings` surface.
 *
 * Exports {@link SettingsService} so the profiles module can read a target
 * user's `whoCanViewProfile` privacy setting when gating profile views. The
 * module is a leaf (imports no other feature module), so this export introduces
 * no dependency cycle.
 */
@Module({
  imports: [MongooseModule.forFeature([{ name: Settings.name, schema: SettingsSchema }])],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
