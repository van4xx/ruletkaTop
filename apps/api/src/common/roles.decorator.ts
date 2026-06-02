import { type CustomDecorator, SetMetadata } from '@nestjs/common';

import type { Role } from '@ruletka/shared-types';

/** Reflector metadata key under which {@link Roles} stores the allowed roles. */
export const ROLES_KEY = 'roles';

/**
 * Restrict a route (or controller) to callers whose JWT `role` is one of the
 * listed {@link Role}s. Read by {@link RolesGuard}; has no effect without that
 * guard AND a preceding authentication guard (e.g. `JwtAuthGuard`) that populates
 * `request.user`.
 *
 * ```ts
 * @UseGuards(JwtAuthGuard, RolesGuard)
 * @Roles('moderator', 'admin')
 * @Get('reports')
 * triage() { … }
 * ```
 */
export const Roles = (...roles: Role[]): CustomDecorator<string> => SetMetadata(ROLES_KEY, roles);
