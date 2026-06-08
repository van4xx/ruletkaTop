import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AdminModule } from '../admin/admin.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CaptchaService } from './captcha.service';
import { FingerprintService } from './fingerprint.service';
import { BannedFingerprint, BannedFingerprintSchema } from './schemas/banned-fingerprint.schema';
import { Session, SessionSchema } from './schemas/session.schema';
import { VerificationToken, VerificationTokenSchema } from './schemas/verification-token.schema';

/**
 * Owns authentication: the `/auth` REST surface and refresh-session lifecycle.
 *
 * Registers its own `sessions` collection. The shared `Profile` model is OWNED
 * by {@link ProfilesModule} (single `forFeature` owner — avoids Mongoose
 * `OverwriteModelError`); importing it brings the re-exported `Profile` model
 * into scope so registration can create the user's profile in the same
 * transaction and login/refresh can read the denormalised premium flag +
 * nickname. Imports {@link UsersModule} for {@link UsersService} (credential
 * lookups + user creation).
 *
 * `JwtService` for access-token signing is provided app-wide by the global
 * `CommonModule`; refresh tokens are signed by {@link AuthService} with the
 * separate `JWT_REFRESH_SECRET`/`JWT_REFRESH_TTL`.
 *
 * Exports {@link AuthService} for any module needing token issuance.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Session.name, schema: SessionSchema },
      { name: BannedFingerprint.name, schema: BannedFingerprintSchema },
      { name: VerificationToken.name, schema: VerificationTokenSchema },
    ]),
    UsersModule,
    ProfilesModule,
    // {@link AdminModule} exports the live-flag `SettingsService` so `register()`
    // can honour the runtime registration kill-switch. AdminModule is a sink
    // (its imports never reach AuthModule), so this adds no dependency cycle.
    AdminModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, CaptchaService, FingerprintService],
  // `AuthService` for token issuance; `FingerprintService` so the moderation
  // ban flow can associate a banned user's fingerprints (ban-evasion).
  exports: [AuthService, FingerprintService],
})
export class AuthModule {}
