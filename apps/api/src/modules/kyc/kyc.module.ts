import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { ProfilesModule } from '../profiles/profiles.module';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { KYC_PROVIDER, type KycProvider } from './providers/kyc-provider.port';
import { NoopKycProvider } from './providers/noop.provider';
import { SumsubProvider } from './providers/sumsub.provider';
import { VeriffProvider } from './providers/veriff.provider';
import {
  KycVerification,
  KycVerificationSchema,
} from './schemas/kyc-verification.schema';

/**
 * KYC (age-verification) module — provider-agnostic orchestration around the
 * {@link KycProvider} port.
 *
 * The active provider is chosen at boot from `KYC_PROVIDER` ∈
 * `sumsub|veriff|noop`. If the chosen provider is `sumsub`/`veriff` but its
 * credentials are missing, the factory FALLS BACK to {@link NoopKycProvider}
 * — onboarding keeps working unaffected (the noop refuses to issue real
 * verifications in production via a 403, so a prod misconfig is loud but does
 * not crash the boot).
 *
 * Imports {@link ProfilesModule} so {@link KycService} can stamp
 * `Profile.ageVerifiedAt` directly (the matchmaking gate reads that field as a
 * boolean — see the soft gate in {@link MatchmakingGateway}).
 *
 * Exports {@link KycService} so the matchmaking gateway can read whether a
 * user's KYC state is `approved` (cheap, the gate code path) when the
 * `KYC_REQUIRED` env is set to `true`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: KycVerification.name, schema: KycVerificationSchema },
    ]),
    ProfilesModule,
  ],
  controllers: [KycController],
  providers: [
    NoopKycProvider,
    SumsubProvider,
    VeriffProvider,
    KycService,
    {
      provide: KYC_PROVIDER,
      useFactory: (
        config: ConfigService,
        sumsub: SumsubProvider,
        veriff: VeriffProvider,
        noop: NoopKycProvider,
      ): KycProvider => {
        const logger = new Logger('KycModule');
        const raw = (config.get<string>('KYC_PROVIDER', 'noop') ?? 'noop').trim().toLowerCase();
        if (raw === 'sumsub') {
          if (sumsub.isConfigured()) return sumsub;
          logger.warn(
            'KYC_PROVIDER=sumsub but credentials missing — falling back to noop adapter',
          );
          return noop;
        }
        if (raw === 'veriff') {
          if (veriff.isConfigured()) return veriff;
          logger.warn(
            'KYC_PROVIDER=veriff but credentials missing — falling back to noop adapter',
          );
          return noop;
        }
        return noop;
      },
      inject: [ConfigService, SumsubProvider, VeriffProvider, NoopKycProvider],
    },
  ],
  exports: [KycService],
})
export class KycModule {}
