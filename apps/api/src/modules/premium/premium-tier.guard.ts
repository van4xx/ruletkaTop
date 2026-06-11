import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { JwtPayload, PremiumTier } from '@ruletka/shared-types';

import { REQUIRES_PREMIUM_TIER_KEY } from './decorators/requires-premium-tier.decorator';
import { PremiumService } from './premium.service';

/**
 * Guard for routes decorated with {@link RequiresPremiumTier}.
 *
 * Reads the required tier off the handler/controller via {@link Reflector}.
 * When no metadata is present the guard is a transparent pass-through, so
 * mounting it globally would be safe — it only kicks in for the decorated
 * routes. Composes with {@link JwtAuthGuard}: it expects an authenticated
 * `JwtPayload` on `request.user`.
 *
 * Error semantics:
 *  - missing/invalid user → 401 (the JWT guard should have caught this first;
 *    we surface it explicitly so a misconfigured pipeline fails closed);
 *  - present but under-tier → 403, message names the required tier so the
 *    client can render a tier-upgrade hint.
 */
@Injectable()
export class PremiumTierGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly premiumService: PremiumService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Walk both the handler and the controller class for the metadata. Method
    // metadata wins if both are set (NestJS's `getAllAndOverride` semantics).
    const required = this.reflector.getAllAndOverride<PremiumTier | undefined>(
      REQUIRES_PREMIUM_TIER_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const userId = request.user?.sub;
    if (!userId) {
      throw new UnauthorizedException('Authentication required for tier-gated endpoint');
    }

    if (await this.premiumService.hasTierOrAbove(userId, required)) {
      return true;
    }
    throw new ForbiddenException({
      message: `Premium tier '${required}' required`,
      requiredTier: required,
    });
  }
}
