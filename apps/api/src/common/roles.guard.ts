import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { JwtPayload, Role } from '@ruletka/shared-types';

import { ROLES_KEY } from './roles.decorator';

/** Express request augmented with the verified JWT payload (see JwtStrategy). */
interface RequestWithUser extends Request {
  user?: JwtPayload;
}

/**
 * RBAC guard enforcing the {@link Roles} decorator. It reads the allowed roles
 * from route- then controller-level metadata; if none is declared the route is
 * NOT role-restricted and access is allowed (authn is still enforced separately
 * by the preceding `JwtAuthGuard`).
 *
 * When roles ARE declared, the request must already carry a `user` (populated by
 * `JwtAuthGuard` / `JwtStrategy`) whose `role` is in the allow-list; otherwise we
 * throw `403 Forbidden`. Missing `user` (guard mis-ordering, or no auth guard) is
 * treated as a denial rather than an accidental allow — fail closed.
 *
 * Order matters: place AFTER the authentication guard, e.g.
 * `@UseGuards(JwtAuthGuard, RolesGuard)`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles on the route/controller → not role-gated.
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    // Fail closed: a role-gated route with no authenticated principal is denied.
    if (!user) {
      throw new ForbiddenException('Insufficient role');
    }

    if (!required.includes(user.role)) {
      throw new ForbiddenException('Insufficient role');
    }

    return true;
  }
}
