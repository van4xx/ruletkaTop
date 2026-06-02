import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { JwtPayload, Role } from '@ruletka/shared-types';

import { RolesGuard } from './roles.guard';

/**
 * Build an ExecutionContext whose request carries `user` (or none), and whose
 * handler/class the Reflector can read `@Roles` metadata from. We stub the
 * Reflector's resolved value directly so the test does not depend on real
 * decorator metadata plumbing.
 */
function makeContext(user: JwtPayload | undefined): ExecutionContext {
  const handler = (): void => undefined;
  const cls = class Dummy {};
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => handler,
    getClass: () => cls,
  } as unknown as ExecutionContext;
}

function user(role: Role): JwtPayload {
  return { sub: '507f1f77bcf86cd799439011', role, isPremium: false };
}

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows when the route declares no @Roles (not role-gated)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(makeContext(user('user')))).toBe(true);
  });

  it('allows a caller whose role is in the allow-list', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['moderator', 'admin']);
    expect(guard.canActivate(makeContext(user('moderator')))).toBe(true);
    expect(guard.canActivate(makeContext(user('admin')))).toBe(true);
  });

  it('denies (403) a caller whose role is NOT in the allow-list', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['moderator', 'admin']);
    expect(() => guard.canActivate(makeContext(user('user')))).toThrow(ForbiddenException);
  });

  it('fails closed (403) when the route is role-gated but no user is present', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });

  it('treats an empty roles array as not role-gated (allows)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);
    expect(guard.canActivate(makeContext(user('user')))).toBe(true);
  });
});
