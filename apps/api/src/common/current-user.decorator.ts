import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { JwtPayload } from '@ruletka/shared-types';

/**
 * Express request augmented with the verified JWT payload that
 * {@link JwtStrategy} attaches as `request.user`.
 */
interface RequestWithUser extends Request {
  user?: JwtPayload;
}

/**
 * Param decorator returning the authenticated user's {@link JwtPayload} (as
 * placed on the request by {@link JwtStrategy}). Optionally pass a key to pluck
 * a single field.
 *
 * ```ts
 * @Get('me')
 * me(@CurrentUser() user: JwtPayload) { … }
 *
 * @Get('id')
 * id(@CurrentUser('sub') userId: string) { … }
 * ```
 *
 * Use together with `@UseGuards(JwtAuthGuard)`; without the guard `user` may be
 * `undefined`.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext): JwtPayload | unknown => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) {
      return undefined;
    }
    return data ? user[data] : user;
  },
);
