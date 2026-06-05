import { NotFoundException } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import { REDIS_CLIENT } from '../../redis/redis.constants';
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

  let service: AdminService;
  let userModel: { findByIdAndUpdate: jest.Mock };
  let authService: { revokeAllSessions: jest.Mock };
  let fingerprintService: { recordForUser: jest.Mock };
  let redis: { publish: jest.Mock };

  beforeEach(async () => {
    userModel = { findByIdAndUpdate: jest.fn() };
    authService = { revokeAllSessions: jest.fn().mockResolvedValue(undefined) };
    fingerprintService = { recordForUser: jest.fn().mockResolvedValue(undefined) };
    redis = { publish: jest.fn().mockResolvedValue(1) };
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
      ],
    }).compile();

    service = moduleRef.get(AdminService);
  });

  it('ban: sets isBanned=true, revokes ALL sessions, and publishes a socket disconnect', async () => {
    userModel.findByIdAndUpdate.mockReturnValue(queryReturning({ _id: userId, isBanned: true }));

    const result = await service.banUser(userId);

    expect(result).toEqual({ userId, isBanned: true });

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

  it('unban: clears isBanned and does NOT revoke sessions or publish', async () => {
    userModel.findByIdAndUpdate.mockReturnValue(queryReturning({ _id: userId, isBanned: false }));

    const result = await service.unbanUser(userId);

    expect(result).toEqual({ userId, isBanned: false });
    const [, update] = userModel.findByIdAndUpdate.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(update).toEqual({ $set: { isBanned: false } });
    expect(authService.revokeAllSessions).not.toHaveBeenCalled();
    expect(redis.publish).not.toHaveBeenCalled();
  });
});
