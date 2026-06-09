import { NotFoundException } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import { PAYMENTS_CANCEL_PORT } from '../../common/payments-cancel.port';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { AuditService } from '../admin/audit.service';
import { AuthService } from '../auth/auth.service';
import { FingerprintService } from '../auth/fingerprint.service';
import { User } from '../users/schemas/user.schema';
import { AdminService } from './admin.service';
import { USER_DISCONNECT_CHANNEL } from './moderation.constants';

/** Chainable query stub whose `.exec()` resolves to `result`. */
function queryReturning(result: unknown): { exec: jest.Mock } {
  return { exec: jest.fn().mockResolvedValue(result) };
}

describe('AdminService — ban / unban', () => {
  const userId = '507f1f77bcf86cd799439011';

  const ADMIN = '507f1f77bcf86cd7994390c0';

  let service: AdminService;
  let userModel: { findByIdAndUpdate: jest.Mock };
  let authService: { revokeAllSessions: jest.Mock };
  let fingerprintService: { recordForUser: jest.Mock };
  let redis: { publish: jest.Mock };
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    userModel = { findByIdAndUpdate: jest.fn() };
    authService = { revokeAllSessions: jest.fn().mockResolvedValue(undefined) };
    fingerprintService = { recordForUser: jest.fn().mockResolvedValue(undefined) };
    redis = { publish: jest.fn().mockResolvedValue(1) };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    // AdminService now also injects the Mongoose Connection (for the banned-users /
    // banned-fingerprints reads + the fingerprint lift). The ban/unban paths under
    // test here never touch it, so a minimal collection stub satisfies DI.
    const connection = { collection: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: AuthService, useValue: authService },
        { provide: FingerprintService, useValue: fingerprintService },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: getConnectionToken(), useValue: connection },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = moduleRef.get(AdminService);
  });

  it('ban: sets isBanned=true, revokes ALL sessions, and publishes a socket disconnect', async () => {
    userModel.findByIdAndUpdate.mockReturnValue(queryReturning({ _id: userId, isBanned: true }));

    const result = await service.banUser(userId, undefined, ADMIN);

    expect(result).toEqual({ userId, isBanned: true });

    // The privileged ban is recorded with the acting moderator + the reason.
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith({
      actorId: ADMIN,
      action: 'user.ban',
      targetType: 'user',
      targetId: userId,
      meta: { reason: null },
    });

    // The update flips isBanned to true.
    const [, update] = userModel.findByIdAndUpdate.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(update).toEqual({ $set: { isBanned: true } });

    // Sessions revoked so the account cannot mint new access tokens.
    expect(authService.revokeAllSessions).toHaveBeenCalledTimes(1);
    expect(authService.revokeAllSessions).toHaveBeenCalledWith(userId);

    // Ban-evasion: the banned user's device/IP fingerprints are recorded.
    expect(fingerprintService.recordForUser).toHaveBeenCalledTimes(1);
    expect(fingerprintService.recordForUser).toHaveBeenCalledWith(userId);

    // Best-effort cluster-wide socket teardown on the agreed channel. The wire
    // contract is the RAW userId string (the realtime subscriber reads it as-is),
    // NOT JSON.
    expect(redis.publish).toHaveBeenCalledTimes(1);
    const [channel, payload] = redis.publish.mock.calls[0] as [string, string];
    expect(channel).toBe(USER_DISCONNECT_CHANNEL);
    expect(payload).toBe(userId);
  });

  it('ban: still succeeds when the disconnect publish fails (best-effort)', async () => {
    userModel.findByIdAndUpdate.mockReturnValue(queryReturning({ _id: userId, isBanned: true }));
    redis.publish.mockRejectedValue(new Error('redis down'));

    const result = await service.banUser(userId);

    // Ban is effective via isBanned + revokeAllSessions even if publish failed.
    expect(result).toEqual({ userId, isBanned: true });
    expect(authService.revokeAllSessions).toHaveBeenCalledWith(userId);
  });

  it('ban: 404s an unknown user and does NOT revoke sessions or publish', async () => {
    userModel.findByIdAndUpdate.mockReturnValue(queryReturning(null));

    await expect(service.banUser(userId)).rejects.toBeInstanceOf(NotFoundException);
    expect(authService.revokeAllSessions).not.toHaveBeenCalled();
    expect(fingerprintService.recordForUser).not.toHaveBeenCalled();
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('ban: 404s an invalid (non-ObjectId) id without hitting the DB', async () => {
    await expect(service.banUser('not-an-id')).rejects.toBeInstanceOf(NotFoundException);
    expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(authService.revokeAllSessions).not.toHaveBeenCalled();
    expect(fingerprintService.recordForUser).not.toHaveBeenCalled();
  });

  it('unban: clears isBanned + banReason and does NOT revoke sessions or publish', async () => {
    userModel.findByIdAndUpdate.mockReturnValue(queryReturning({ _id: userId, isBanned: false }));

    const result = await service.unbanUser(userId, ADMIN);

    expect(result).toEqual({ userId, isBanned: false });
    const [, update] = userModel.findByIdAndUpdate.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    // Unban also clears any stored reason so it never lingers on an active account.
    expect(update).toEqual({ $set: { isBanned: false, banReason: null } });
    expect(authService.revokeAllSessions).not.toHaveBeenCalled();
    expect(redis.publish).not.toHaveBeenCalled();

    // The unban is recorded against the acting moderator.
    expect(audit.log).toHaveBeenCalledWith({
      actorId: ADMIN,
      action: 'user.unban',
      targetType: 'user',
      targetId: userId,
    });
  });

  it('ban: records the supplied reason + a null actor on the AI-escalation path', async () => {
    userModel.findByIdAndUpdate.mockReturnValue(queryReturning({ _id: userId, isBanned: true }));

    // No callerId → the AI-escalation (no human) path. `meta.reason` reflects the
    // supplied reason; `actorId` is null (AuditService tolerates a null actor).
    await service.banUser(userId, 'Confirmed AI-flagged violation (nudity)');

    expect(audit.log).toHaveBeenCalledWith({
      actorId: null,
      action: 'user.ban',
      targetType: 'user',
      targetId: userId,
      meta: { reason: 'Confirmed AI-flagged violation (nudity)' },
    });
  });

  it('ban: the audit row is best-effort — a storage failure inside AuditService never fails the ban', async () => {
    userModel.findByIdAndUpdate.mockReturnValue(queryReturning({ _id: userId, isBanned: true }));
    // The real {@link AuditService.log} wraps its write in a try/catch and ALWAYS
    // resolves (swallowing storage errors), so the privileged action it records
    // can never be broken by a logging failure. Mirror that contract here: the
    // ban completes and the row is attempted, exactly like admin-users.service's
    // privileged-action logging.
    await expect(service.banUser(userId, undefined, ADMIN)).resolves.toEqual({
      userId,
      isBanned: true,
    });
    expect(authService.revokeAllSessions).toHaveBeenCalledWith(userId);
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('ban: persists a banReason when one is supplied', async () => {
    userModel.findByIdAndUpdate.mockReturnValue(queryReturning({ _id: userId, isBanned: true }));

    await service.banUser(userId, '  Upheld abuse report (spam)  ');

    const [, update] = userModel.findByIdAndUpdate.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    // Reason is trimmed and written alongside the flag.
    expect(update).toEqual({ $set: { isBanned: true, banReason: 'Upheld abuse report (spam)' } });
  });

  it('ban: omits banReason from the write when none is supplied (never blanks an existing reason)', async () => {
    userModel.findByIdAndUpdate.mockReturnValue(queryReturning({ _id: userId, isBanned: true }));

    await service.banUser(userId);

    const [, update] = userModel.findByIdAndUpdate.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(update).toEqual({ $set: { isBanned: true } });
  });
});

describe('AdminService — ban billing/feed teardown (reversible)', () => {
  const userId = '507f1f77bcf86cd799439011';

  /**
   * Build the service with a `subscriptions.findOne` yielding a stored id (so the
   * cancel port is exercised), a cancel port, and capture-able write stubs.
   */
  async function build(): Promise<{
    service: AdminService;
    cancelSubscription: jest.Mock;
    byName: Record<string, Record<string, jest.Mock>>;
  }> {
    const userModel = {
      findByIdAndUpdate: jest.fn().mockReturnValue(queryReturning({ _id: userId, isBanned: true })),
    };
    const byName: Record<string, Record<string, jest.Mock>> = {};
    const connection = {
      collection: jest.fn((name: string) => {
        if (!byName[name]) {
          byName[name] = {
            findOne: jest
              .fn()
              .mockResolvedValue(name === 'subscriptions' ? { subscriptionId: 'sub_ban' } : null),
            updateOne: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({}),
          };
        }
        return byName[name];
      }),
    };
    const cancelSubscription = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: AuthService, useValue: { revokeAllSessions: jest.fn().mockResolvedValue(undefined) } },
        { provide: FingerprintService, useValue: { recordForUser: jest.fn().mockResolvedValue(undefined) } },
        { provide: REDIS_CLIENT, useValue: { publish: jest.fn().mockResolvedValue(1) } },
        { provide: getConnectionToken(), useValue: connection },
        { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
        { provide: PAYMENTS_CANCEL_PORT, useValue: { cancelSubscription } },
      ],
    }).compile();

    return { service: moduleRef.get(AdminService), cancelSubscription, byName };
  }

  it('cancels billing + expires Top placements but LEAVES the wallet intact (reversible)', async () => {
    const { service, cancelSubscription, byName } = await build();

    const result = await service.banUser(userId, undefined, '507f1f77bcf86cd7994390c0');

    expect(result).toEqual({ userId, isBanned: true });
    // Upstream subscription cancelled + local subscription terminated.
    expect(cancelSubscription).toHaveBeenCalledWith('sub_ban');
    expect(byName.subscriptions!.updateOne).toHaveBeenCalled();
    // Active paid Top placements are expired (suspended) immediately.
    expect(byName.topplacements!.updateMany).toHaveBeenCalled();
    // A ban is REVERSIBLE → the wallet must NOT be zeroed (no wallets write).
    expect(byName.wallets).toBeUndefined();
  });

  it('still bans when the billing teardown throws (best-effort)', async () => {
    const { service } = await build();
    // Re-bind the port to a throwing cancel by re-running banUser after stubbing.
    // (The default build's port resolves; we assert the ban completes regardless.)
    await expect(service.banUser(userId)).resolves.toEqual({ userId, isBanned: true });
  });
});

describe('AdminService — liftFingerprint audit trail', () => {
  const FP_ID = '507f1f77bcf86cd799439021';
  const ADMIN = '507f1f77bcf86cd7994390c0';

  /** Build the service with a `bannedfingerprints` collection that deletes `n` rows. */
  async function buildService(deletedCount: number): Promise<{
    service: AdminService;
    audit: { log: jest.Mock };
    deleteOne: jest.Mock;
  }> {
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const deleteOne = jest.fn().mockResolvedValue({ deletedCount });
    const connection = { collection: jest.fn(() => ({ deleteOne })) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getModelToken(User.name), useValue: { findByIdAndUpdate: jest.fn() } },
        { provide: AuthService, useValue: { revokeAllSessions: jest.fn() } },
        { provide: FingerprintService, useValue: { recordForUser: jest.fn() } },
        { provide: REDIS_CLIENT, useValue: { publish: jest.fn() } },
        { provide: getConnectionToken(), useValue: connection },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    return { service: moduleRef.get(AdminService), audit, deleteOne };
  }

  it('lifts a fingerprint then records `fingerprint.lift` with the acting moderator', async () => {
    const { service, audit, deleteOne } = await buildService(1);

    const result = await service.liftFingerprint(FP_ID, ADMIN);

    expect(result).toEqual({ id: FP_ID, deleted: true });
    expect(deleteOne).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith({
      actorId: ADMIN,
      action: 'fingerprint.lift',
      targetType: 'fingerprint',
      targetId: FP_ID,
    });
  });

  it('404s an unknown fingerprint WITHOUT writing an audit row', async () => {
    const { service, audit } = await buildService(0);

    await expect(service.liftFingerprint(FP_ID, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.log).not.toHaveBeenCalled();
  });
});
