import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { JwtStrategy } from './jwt.strategy';

/**
 * Global module wiring the authentication scaffold so any feature module can
 * use `@UseGuards(JwtAuthGuard)` and `@CurrentUser()` out of the box.
 *
 * It registers:
 * - {@link PassportModule} with the default `'jwt'` strategy,
 * - {@link JwtModule} configured from `JWT_ACCESS_SECRET` / `JWT_ACCESS_TTL`
 *   (re-exported so the auth feature module can SIGN tokens with the same
 *   settings), and
 * - the {@link JwtStrategy} provider (token VERIFICATION).
 *
 * Being `@Global`, the exported `JwtModule` is injectable everywhere without
 * re-importing.
 */
@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          // Pin the signing algorithm so issued access tokens are always HS256.
          algorithm: 'HS256',
          // ConfigService yields a string; jsonwebtoken types `expiresIn` as the
          // narrow ms.StringValue | number. A valid ms string ('900s', '30d') is
          // correct at runtime, so assert it to the library's expected type.
          expiresIn: config.get<string>('JWT_ACCESS_TTL', '900s') as NonNullable<
            JwtModuleOptions['signOptions']
          >['expiresIn'],
        },
        // Pin the accepted verification algorithm to HS256 so a token forged
        // with `alg: none` (or asymmetric confusion) can never be accepted by
        // any consumer of this shared JwtService (e.g. profiles' optional decode).
        verifyOptions: {
          algorithms: ['HS256'],
        },
      }),
    }),
  ],
  providers: [JwtStrategy],
  exports: [JwtModule, PassportModule],
})
export class CommonModule {}
