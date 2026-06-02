import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Route guard enforcing a valid JWT access token via {@link JwtStrategy}
 * (registered under the `'jwt'` name). Apply with `@UseGuards(JwtAuthGuard)`.
 *
 * On success `request.user` holds the verified `JwtPayload`. Extend this class
 * later for public-route bypass (`@Public()` metadata) without touching call
 * sites.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
