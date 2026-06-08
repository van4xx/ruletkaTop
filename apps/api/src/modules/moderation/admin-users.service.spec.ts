import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

import type { Connection } from 'mongoose';
import type { Model } from 'mongoose';

import type { Role } from '@ruletka/shared-types';

import type { AuditService } from '../admin/audit.service';
import type { AuthService } from '../auth/auth.service';
import type { UserDocument } from '../users/schemas/user.schema';
import { AdminUsersService } from './admin-users.service';

/** A no-op {@link AuditService} stub whose `log` is a resolved jest mock. */
function auditStub(): AuditService & { log: jest.Mock } {
  return { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService & {
    log: jest.Mock;
  };
}

const USER_A = '507f1f77bcf86cd7994390a1';
const USER_B = '507f1f77bcf86cd7994390a2';
const ADMIN = '507f1f77bcf86cd7994390c0';
const CREATED = new Date('2024-01-02T03:04:05.000Z');

/** A `{ toArray }` cursor stub resolving to `rows`. */
function cursor(rows: unknown[]): { toArray: jest.Mock } {
  return { toArray: jest.fn().mockResolvedValue(rows) };
}

/** A `profiles.find(...)` chain stub: `.find().limit?().toArray()` and `.find().toArray()`. */
function profilesFind(rows: unknown[]): jest.Mock {
  return jest.fn(() => ({
    toArray: jest.fn().mockResolvedValue(rows),
    limit: jest.fn(() => cursor(rows)),
  }));
}

/** Build a `connection` whose `collection('profiles')` returns the given find stub. */
function connectionWith(profilesFindFn: jest.Mock): Connection {
  const collection = jest.fn((name: string) => {
    if (name === 'profiles') {
      return { find: profilesFindFn };
    }
    return { find: jest.fn(() => cursor([])) };
  });
  return { collection } as unknown as Connection;
}

/**
 * Chainable `userModel.find(...)` stub:
 * `.find().sort().limit().select().lean().exec()` resolves to `rows`.
 */
function findChain(rows: unknown[]): jest.Mock {
  const chain = {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(rows),
  };
  return jest.fn(() => chain);
}

function userRow(id: string, over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    _id: new Types.ObjectId(id),
    email: `${id}@x.io`,
    role: 'user' as Role,
    isBanned: false,
    emailVerified: false,
    createdAt: CREATED,
    ...over,
  };
}

describe('AdminUsersService.listUsers', () => {
  it('joins profiles, shapes summaries, and reports no more when under the limit', async () => {
    const userModel = {
      find: findChain([userRow(USER_A, { isBanned: true }), userRow(USER_B)]),
    } as unknown as Model<UserDocument>;
    const find = profilesFind([
      {
        userId: new Types.ObjectId(USER_A),
        nickname: 'Aa',
        isPremium: true,
        country: 'RU',
        gender: 'male',
      },
      // USER_B has no profile row → defaults.
    ]);
    const service = new AdminUsersService(
      userModel,
      connectionWith(find),
      {} as AuthService,
      auditStub(),
    );

    const res = await service.listUsers({ limit: 30 });

    expect(res.hasMore).toBe(false);
    expect(res.nextCursor).toBeNull();
    expect(res.items).toEqual([
      {
        id: USER_A,
        email: `${USER_A}@x.io`,
        nickname: 'Aa',
        role: 'user',
        isPremium: true,
        emailVerified: false,
        isBanned: true,
        country: 'RU',
        gender: 'male',
        createdAt: CREATED.toISOString(),
      },
      {
        id: USER_B,
        email: `${USER_B}@x.io`,
        nickname: '',
        role: 'user',
        isPremium: false,
        emailVerified: false,
        isBanned: false,
        country: null,
        gender: null,
        createdAt: CREATED.toISOString(),
      },
    ]);
  });

  it('sets hasMore + nextCursor when an extra row is returned (limit+1)', async () => {
    // limit 1 → service fetches 2; both returned means there IS a next page.
    const userModel = {
      find: findChain([userRow(USER_A), userRow(USER_B)]),
    } as unknown as Model<UserDocument>;
    const service = new AdminUsersService(
      userModel,
      connectionWith(profilesFind([])),
      {} as AuthService,
      auditStub(),
    );

    const res = await service.listUsers({ limit: 1 });

    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.id).toBe(USER_A);
    expect(res.hasMore).toBe(true);
    expect(res.nextCursor).toBe(USER_A); // the last returned row's id
  });

  it('applies role + banned filters and the keyset cursor (_id < cursor)', async () => {
    const find = findChain([]);
    const userModel = { find } as unknown as Model<UserDocument>;
    const service = new AdminUsersService(
      userModel,
      connectionWith(profilesFind([])),
      {} as AuthService,
      auditStub(),
    );

    await service.listUsers({ limit: 30, role: 'moderator', banned: true, cursor: USER_A });

    const filter = (find.mock.calls[0]! as unknown[])[0] as Record<string, unknown>;
    expect(filter.role).toBe('moderator');
    expect(filter.isBanned).toBe(true);
    expect(filter._id).toEqual({ $lt: new Types.ObjectId(USER_A) });
  });

  it('text search ORs an email regex with nickname-matched userIds from profiles', async () => {
    const find = findChain([]);
    const userModel = { find } as unknown as Model<UserDocument>;
    // profiles.find for the nickname lookup returns one match.
    const profileLookup = profilesFind([{ userId: new Types.ObjectId(USER_B) }]);
    const service = new AdminUsersService(
      userModel,
      connectionWith(profileLookup),
      {} as AuthService,
      auditStub(),
    );

    await service.listUsers({ limit: 30, q: 'ali.ce' });

    const filter = (find.mock.calls[0]! as unknown[])[0] as { $or: Array<Record<string, unknown>> };
    expect(filter.$or).toHaveLength(2);
    // Email branch is a case-insensitive regex with the dot ESCAPED (literal).
    const emailBranch = filter.$or[0]!.email as RegExp;
    expect(emailBranch).toBeInstanceOf(RegExp);
    expect(emailBranch.flags).toContain('i');
    expect(emailBranch.source).toContain('ali\\.ce');
    // Nickname branch is the resolved userIds.
    expect(filter.$or[1]!._id).toEqual({ $in: [new Types.ObjectId(USER_B)] });
  });
});

describe('AdminUsersService.getUser', () => {
  it('404s an invalid id without touching the DB', async () => {
    const userModel = { findById: jest.fn() } as unknown as Model<UserDocument>;
    const service = new AdminUsersService(
      userModel,
      connectionWith(profilesFind([])),
      {} as AuthService,
      auditStub(),
    );
    await expect(service.getUser('not-an-id')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s when the user is missing', async () => {
    const findById = jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    }));
    const userModel = { findById } as unknown as Model<UserDocument>;
    const service = new AdminUsersService(
      userModel,
      connectionWith(profilesFind([])),
      {} as AuthService,
      auditStub(),
    );
    await expect(service.getUser(USER_A)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AdminUsersService.setRole', () => {
  function modelForRoleChange(beforeRole: Role) {
    const findById = jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue({ role: beforeRole }),
    }));
    const findByIdAndUpdate = jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(userRow(USER_A, { role: 'user' })),
    }));
    return { findById, findByIdAndUpdate };
  }

  it('rejects a non-admin caller (defence-in-depth) with 403', async () => {
    const userModel = {} as unknown as Model<UserDocument>;
    const auth = { revokeAllSessions: jest.fn() } as unknown as AuthService;
    const service = new AdminUsersService(
      userModel,
      connectionWith(profilesFind([])),
      auth,
      auditStub(),
    );

    await expect(service.setRole(USER_A, 'admin', 'moderator', ADMIN)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('blocks an admin from demoting their own account (400)', async () => {
    const userModel = {} as unknown as Model<UserDocument>;
    const auth = { revokeAllSessions: jest.fn() } as unknown as AuthService;
    const service = new AdminUsersService(
      userModel,
      connectionWith(profilesFind([])),
      auth,
      auditStub(),
    );

    await expect(service.setRole(ADMIN, 'user', 'admin', ADMIN)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('revokes the target sessions on a demotion (admin → user) and audits the change', async () => {
    const model = modelForRoleChange('admin');
    const userModel = model as unknown as Model<UserDocument>;
    const revokeAllSessions = jest.fn().mockResolvedValue(undefined);
    const auth = { revokeAllSessions } as unknown as AuthService;
    const audit = auditStub();
    const service = new AdminUsersService(userModel, connectionWith(profilesFind([])), auth, audit);

    const res = await service.setRole(USER_A, 'user', 'admin', ADMIN);

    expect(model.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    const [, update] = model.findByIdAndUpdate.mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
    ];
    expect(update).toEqual({ $set: { role: 'user' } });
    expect(revokeAllSessions).toHaveBeenCalledWith(USER_A);
    expect(res.id).toBe(USER_A);

    // The privileged role change is recorded with the actor + before/after roles.
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith({
      actorId: ADMIN,
      action: 'user.role.set',
      targetType: 'user',
      targetId: USER_A,
      meta: { from: 'admin', to: 'user', sessionsRevoked: true },
    });
  });

  it('does NOT revoke sessions on a promotion (user → moderator)', async () => {
    const model = modelForRoleChange('user');
    const userModel = model as unknown as Model<UserDocument>;
    const revokeAllSessions = jest.fn().mockResolvedValue(undefined);
    const auth = { revokeAllSessions } as unknown as AuthService;
    const service = new AdminUsersService(
      userModel,
      connectionWith(profilesFind([])),
      auth,
      auditStub(),
    );

    await service.setRole(USER_A, 'moderator', 'admin', ADMIN);

    expect(revokeAllSessions).not.toHaveBeenCalled();
  });

  it('404s when the target user does not exist', async () => {
    const findById = jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    }));
    const userModel = { findById } as unknown as Model<UserDocument>;
    const auth = { revokeAllSessions: jest.fn() } as unknown as AuthService;
    const service = new AdminUsersService(
      userModel,
      connectionWith(profilesFind([])),
      auth,
      auditStub(),
    );

    await expect(service.setRole(USER_A, 'moderator', 'admin', ADMIN)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('AdminUsersService — audit trail for privileged actions', () => {
  it('verifyEmail records `user.email.verify` with the actor + target', async () => {
    const findOneAndUpdate = jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(userRow(USER_A, { emailVerified: true })),
    }));
    const userModel = { findOneAndUpdate } as unknown as Model<UserDocument>;
    const audit = auditStub();
    const service = new AdminUsersService(
      userModel,
      connectionWith(profilesFind([])),
      {} as AuthService,
      audit,
    );

    await service.verifyEmail(USER_A, ADMIN);

    expect(audit.log).toHaveBeenCalledWith({
      actorId: ADMIN,
      action: 'user.email.verify',
      targetType: 'user',
      targetId: USER_A,
    });
  });

  it('does NOT audit verifyEmail when the user is missing (404 before the log)', async () => {
    const findOneAndUpdate = jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    }));
    const userModel = { findOneAndUpdate } as unknown as Model<UserDocument>;
    const audit = auditStub();
    const service = new AdminUsersService(
      userModel,
      connectionWith(profilesFind([])),
      {} as AuthService,
      audit,
    );

    await expect(service.verifyEmail(USER_A, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('forceLogout revokes sessions then records `user.force_logout`', async () => {
    const userModel = {
      exists: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(USER_A) }),
    } as unknown as Model<UserDocument>;
    const revokeAllSessions = jest.fn().mockResolvedValue(undefined);
    const auth = { revokeAllSessions } as unknown as AuthService;
    const audit = auditStub();
    const service = new AdminUsersService(userModel, connectionWith(profilesFind([])), auth, audit);

    await service.forceLogout(USER_A, ADMIN);

    expect(revokeAllSessions).toHaveBeenCalledWith(USER_A);
    expect(audit.log).toHaveBeenCalledWith({
      actorId: ADMIN,
      action: 'user.force_logout',
      targetType: 'user',
      targetId: USER_A,
    });
  });

  it('deleteUser records `user.delete` after the erasure', async () => {
    const userDoc = {
      _id: new Types.ObjectId(USER_A),
      deletedAt: null,
      save: jest.fn().mockResolvedValue(undefined),
    };
    const userModel = {
      findById: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(userDoc) })),
    } as unknown as Model<UserDocument>;
    // The delete path scrubs `profiles` + `sessions` via the raw connection.
    const connection = {
      collection: jest.fn(() => ({
        updateOne: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({}),
        find: jest.fn(() => cursor([])),
      })),
    } as unknown as Connection;
    const auth = { revokeAllSessions: jest.fn() } as unknown as AuthService;
    const audit = auditStub();
    const service = new AdminUsersService(userModel, connection, auth, audit);

    await service.deleteUser(USER_A, ADMIN);

    expect(audit.log).toHaveBeenCalledWith({
      actorId: ADMIN,
      action: 'user.delete',
      targetType: 'user',
      targetId: USER_A,
    });
  });
});
