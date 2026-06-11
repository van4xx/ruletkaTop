import { SetMetadata } from '@nestjs/common';

import type { PremiumTier } from '@ruletka/shared-types';

/**
 * Reflector metadata key used by {@link PremiumTierGuard} to read the
 * required tier off a route handler / controller. Kept as an exported const
 * (not a string literal at the call site) so a refactor of the key triggers
 * a compile error rather than a silent gate bypass.
 */
export const REQUIRES_PREMIUM_TIER_KEY = 'requires_premium_tier';

/**
 * Mark a route (or every route on a controller) as requiring at-or-above the
 * given premium tier. Paired with {@link PremiumTierGuard}, which reads this
 * metadata via `Reflector` and 403s an under-tier caller.
 *
 * Usage:
 * ```ts
 * @UseGuards(JwtAuthGuard, PremiumTierGuard)
 * @RequiresPremiumTier('pro')
 * @Get('/incognito-only-thing')
 * thing(@CurrentUser() user: JwtPayload) { ... }
 * ```
 *
 * Composes with {@link JwtAuthGuard} — the guard expects a `JwtPayload` on
 * `request.user`, exactly like every other gated endpoint in the codebase.
 */
export const RequiresPremiumTier = (tier: PremiumTier): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRES_PREMIUM_TIER_KEY, tier);
