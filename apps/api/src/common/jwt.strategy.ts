import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, type StrategyOptionsWithoutRequest } from 'passport-jwt';

import type { JwtPayload } from '@ruletka/shared-types';

import { jwtPayloadSchema, type LocalJwtPayload } from './jwt-payload.schema';

/**
 * Compile-time guarantee that the locally re-declared runtime schema stays
 * structurally identical to the shared `JwtPayload` contract. If shared-types
 * changes shape, one of these assignments fails to compile.
 */
type _AssertLocalMatchesShared = LocalJwtPayload extends JwtPayload ? true : never;
type _AssertSharedMatchesLocal = JwtPayload extends LocalJwtPayload ? true : never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _typeChecks: [_AssertLocalMatchesShared, _AssertSharedMatchesLocal] = [true, true];

/**
 * Passport strategy verifying the JWT **access** token (Bearer header) using
 * `JWT_ACCESS_SECRET`. The returned object becomes `request.user`, typed as the
 * shared {@link JwtPayload} and surfaced through the `@CurrentUser()` decorator.
 *
 * Feature modules (auth) own token issuance; this scaffold only validates.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_ACCESS_SECRET');
    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET is not configured');
    }

    const options: StrategyOptionsWithoutRequest = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      // Only accept HS256-signed access tokens. Without this, passport-jwt
      // would honour the token's own `alg` header, leaving the door open to
      // an `alg: none` forgery or an algorithm-confusion attack.
      algorithms: ['HS256'],
    };
    super(options);
  }

  /**
   * Passport calls this with the already signature-verified, unexpired payload.
   * We additionally validate its SHAPE with Zod so a token signed with the
   * right secret but a malformed body is rejected rather than trusted.
   */
  validate(payload: unknown): JwtPayload {
    const result = jwtPayloadSchema.safeParse(payload);
    if (!result.success) {
      throw new UnauthorizedException('Malformed token payload');
    }
    return result.data;
  }
}
