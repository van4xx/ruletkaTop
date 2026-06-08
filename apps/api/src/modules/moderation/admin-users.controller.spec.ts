import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { JwtPayload, Role } from '@ruletka/shared-types';

import { RolesGuard } from '../../common/roles.guard';
import { AdminUsersController } from './admin-users.controller';
import type { AdminUsersService } from './admin-users.service';

const CALLER = '507f1f77bcf86cd7994390c0';
const TARGET = '507f1f77bcf86cd7994390a1';

function principal(role: Role): JwtPayload {
  return { sub: CALLER, role, isPremium: false };
}

/**
 * An ExecutionContext pointed at a real controller method, so the real
 * {@link RolesGuard} resolves the `@Roles` metadata the decorators actually
 * stamped on the route/class (handler-first via `getAllAndOverride`).
 */
function contextFor(method: keyof AdminUsersController, user: JwtPayload): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => AdminUsersController.prototype[method],
    getClass: () => AdminUsersController,
  } as unknown as ExecutionContext;
}

describe('AdminUsersController role gating (real RolesGuard + real route metadata)', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows a moderator to LIST users', () => {
    expect(guard.canActivate(contextFor('list', principal('moderator')))).toBe(true);
  });

  it('allows a moderator to GET one user', () => {
    expect(guard.canActivate(contextFor('getOne', principal('moderator')))).toBe(true);
  });

  it('FORBIDS a moderator from changing a role (setRole is admin-only)', () => {
    expect(() => guard.canActivate(contextFor('setRole', principal('moderator')))).toThrow(
      ForbiddenException,
    );
  });

  it('allows an admin to change a role', () => {
    expect(guard.canActivate(contextFor('setRole', principal('admin')))).toBe(true);
  });

  it('forbids a regular user everywhere on this controller', () => {
    expect(() => guard.canActivate(contextFor('list', principal('user')))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(contextFor('setRole', principal('user')))).toThrow(
      ForbiddenException,
    );
  });
});

describe('AdminUsersController delegation', () => {
  it('setRole forwards the target id, requested role, and CALLER identity to the service', async () => {
    const setRole = jest.fn().mockResolvedValue({ id: TARGET });
    const service = { setRole } as unknown as AdminUsersService;
    const controller = new AdminUsersController(service);

    await controller.setRole(TARGET, { role: 'moderator' }, principal('admin'));

    // The service re-checks admin-only using the caller's role + id (defence-in-depth).
    expect(setRole).toHaveBeenCalledWith(TARGET, 'moderator', 'admin', CALLER);
  });

  it('list forwards the parsed query to the service', async () => {
    const listUsers = jest.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    const service = { listUsers } as unknown as AdminUsersService;
    const controller = new AdminUsersController(service);

    await controller.list({ limit: 30, q: 'bob' });

    expect(listUsers).toHaveBeenCalledWith({ limit: 30, q: 'bob' });
  });

  it('verifyEmail forwards the CALLER identity (so the action can be audited)', async () => {
    const verifyEmail = jest.fn().mockResolvedValue({ id: TARGET });
    const service = { verifyEmail } as unknown as AdminUsersService;
    const controller = new AdminUsersController(service);

    await controller.verifyEmail(TARGET, principal('admin'));

    expect(verifyEmail).toHaveBeenCalledWith(TARGET, CALLER);
  });

  it('forceLogout forwards the CALLER identity (so the action can be audited)', async () => {
    const forceLogout = jest.fn().mockResolvedValue({ ok: true });
    const service = { forceLogout } as unknown as AdminUsersService;
    const controller = new AdminUsersController(service);

    await controller.forceLogout(TARGET, principal('admin'));

    expect(forceLogout).toHaveBeenCalledWith(TARGET, CALLER);
  });

  it('deleteUser forwards the CALLER identity (so the action can be audited)', async () => {
    const deleteUser = jest.fn().mockResolvedValue({ ok: true });
    const service = { deleteUser } as unknown as AdminUsersService;
    const controller = new AdminUsersController(service);

    await controller.deleteUser(TARGET, principal('admin'));

    expect(deleteUser).toHaveBeenCalledWith(TARGET, CALLER);
  });
});
