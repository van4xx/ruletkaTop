import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';

import { AdminService } from './admin.service';
import { AppealsService } from './appeals.service';
import { Appeal } from './schemas/appeal.schema';
import { UsersService } from '../users/users.service';

const USER = '507f1f77bcf86cd799439011';
const APPEAL = '507f1f77bcf86cd799439077';
const PASSWORD = 'CorrectHorse9!';
const MESSAGE = 'I believe this ban was a mistake — please review my case.';

/** Chainable `.exec()` query stub. */
function queryReturning(result: unknown): { exec: jest.Mock } {
  return { exec: jest.fn().mockResolvedValue(result) };
}

/** A hydrated appeal stub the service maps via `toContract` + mutates on resolve. */
function appealDoc(status: 'pending' | 'accepted' | 'rejected' = 'pending'): Record<string, unknown> {
  return {
    _id: { toString: () => APPEAL },
    userId: { toString: () => USER },
    email: 'banned@example.com',
    nickname: 'NeonFox',
    banReason: 'Upheld abuse report',
    message: MESSAGE,
    status,
    resolvedAt: null,
    decidedBy: null,
    get: (_k: string) => new Date('2026-06-01T00:00:00.000Z'),
    save: jest.fn().mockResolvedValue(undefined),
  };
}

describe('AppealsService', () => {
  let service: AppealsService;
  let appealModel: { exists: jest.Mock; create: jest.Mock; findById: jest.Mock };
  let usersService: { findByEmailWithSecret: jest.Mock };
  let adminService: { unbanUser: jest.Mock };
  let profilesCollection: { findOne: jest.Mock };
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await argon2.hash(PASSWORD);
  });

  /** A banned user document with the real hash for the verify path. */
  function bannedUser(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
      _id: { toString: () => USER },
      email: 'banned@example.com',
      passwordHash,
      isBanned: true,
      banReason: 'Upheld abuse report',
      ...over,
    };
  }

  beforeEach(async () => {
    appealModel = {
      exists: jest.fn().mockReturnValue(queryReturning(null)),
      create: jest.fn().mockResolvedValue(appealDoc()),
      findById: jest.fn().mockReturnValue(queryReturning(appealDoc())),
    };
    usersService = { findByEmailWithSecret: jest.fn().mockResolvedValue(bannedUser()) };
    adminService = { unbanUser: jest.fn().mockResolvedValue({ userId: USER, isBanned: false }) };
    profilesCollection = {
      findOne: jest.fn().mockResolvedValue({ nickname: 'NeonFox' }),
    };
    const connection = { collection: jest.fn().mockReturnValue(profilesCollection) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AppealsService,
        { provide: getModelToken(Appeal.name), useValue: appealModel },
        { provide: getConnectionToken(), useValue: connection },
        { provide: UsersService, useValue: usersService },
        { provide: AdminService, useValue: adminService },
      ],
    }).compile();

    service = moduleRef.get(AppealsService);
  });

  // ── submitAppeal ─────────────────────────────────────────────────────────

  it('creates a pending appeal for a banned account on valid credentials', async () => {
    const appeal = await service.submitAppeal({
      email: 'banned@example.com',
      password: PASSWORD,
      message: MESSAGE,
    });

    expect(appeal.status).toBe('pending');
    expect(appeal.userId).toBe(USER);
    const created = appealModel.create.mock.calls[0][0] as Record<string, unknown>;
    // Denormalised identity + ban reason captured at submit time.
    expect(created.email).toBe('banned@example.com');
    expect(created.nickname).toBe('NeonFox');
    expect(created.banReason).toBe('Upheld abuse report');
    expect(created.status).toBe('pending');
  });

  it('rejects an unknown email with a generic 401 (no enumeration)', async () => {
    usersService.findByEmailWithSecret.mockResolvedValue(null);
    await expect(
      service.submitAppeal({ email: 'nope@example.com', password: PASSWORD, message: MESSAGE }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(appealModel.create).not.toHaveBeenCalled();
  });

  it('rejects a wrong password with a generic 401', async () => {
    await expect(
      service.submitAppeal({ email: 'banned@example.com', password: 'wrong-pass', message: MESSAGE }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(appealModel.create).not.toHaveBeenCalled();
  });

  it('rejects a NON-banned account with 403 (nothing to appeal)', async () => {
    usersService.findByEmailWithSecret.mockResolvedValue(
      bannedUser({ isBanned: false, banReason: null }),
    );
    await expect(
      service.submitAppeal({ email: 'banned@example.com', password: PASSWORD, message: MESSAGE }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(appealModel.create).not.toHaveBeenCalled();
  });

  it('409s a second appeal while one is still pending', async () => {
    appealModel.exists.mockReturnValue(queryReturning({ _id: 'x' }));
    await expect(
      service.submitAppeal({ email: 'banned@example.com', password: PASSWORD, message: MESSAGE }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(appealModel.create).not.toHaveBeenCalled();
  });

  it('409s the check-then-create race: a concurrent insert tripping the partial-unique index (E11000) maps to 409', async () => {
    // The non-atomic pre-check passes (no pending row visible yet)…
    appealModel.exists.mockReturnValue(queryReturning(null));
    // …but a concurrent second submit already won the race, so the partial
    // unique index (one pending appeal per user) rejects this insert.
    appealModel.create.mockRejectedValue(
      Object.assign(new Error('E11000 duplicate key error'), { code: 11000 }),
    );
    await expect(
      service.submitAppeal({ email: 'banned@example.com', password: PASSWORD, message: MESSAGE }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rethrows a non-duplicate create error unchanged', async () => {
    appealModel.exists.mockReturnValue(queryReturning(null));
    appealModel.create.mockRejectedValue(new Error('connection reset'));
    await expect(
      service.submitAppeal({ email: 'banned@example.com', password: PASSWORD, message: MESSAGE }),
    ).rejects.toThrow('connection reset');
  });

  // ── resolve ────────────────────────────────────────────────────────────────

  it('accepting an appeal unbans the user and stamps the decision', async () => {
    const doc = appealDoc();
    appealModel.findById.mockReturnValue(queryReturning(doc));

    const result = await service.resolve(APPEAL, 'accepted', USER);

    // The unban is attributed to the deciding moderator (threaded through).
    expect(adminService.unbanUser).toHaveBeenCalledWith(USER, USER);
    expect(result.ban).toEqual({ userId: USER, isBanned: false });
    expect(doc.status).toBe('accepted');
    expect(doc.resolvedAt).toBeInstanceOf(Date);
    expect(doc.save).toHaveBeenCalledTimes(1);
  });

  it('rejecting an appeal leaves the ban in place (no unban call)', async () => {
    const doc = appealDoc();
    appealModel.findById.mockReturnValue(queryReturning(doc));

    const result = await service.resolve(APPEAL, 'rejected', USER);

    expect(adminService.unbanUser).not.toHaveBeenCalled();
    expect(result.ban).toEqual({ userId: USER, isBanned: true });
    expect(doc.status).toBe('rejected');
  });

  it('409s resolving an already-decided appeal (no double-action)', async () => {
    appealModel.findById.mockReturnValue(queryReturning(appealDoc('accepted')));
    await expect(service.resolve(APPEAL, 'rejected', USER)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(adminService.unbanUser).not.toHaveBeenCalled();
  });
});
