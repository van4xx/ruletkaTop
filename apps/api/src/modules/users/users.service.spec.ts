import { Types } from 'mongoose';

import type { Connection, Model } from 'mongoose';

import type { PaymentsCancelPort } from '../../common/payments-cancel.port';
import type { AvatarStorageService } from '../profiles/avatar-storage.service';
import { UsersService } from './users.service';
import type { UserDocument } from './schemas/user.schema';

const USER_ID = '507f1f77bcf86cd799439011';

/**
 * A `connection` whose `collection(name)` returns a fresh stub exposing every
 * method the erase + teardown + export paths touch. The `subscriptions`
 * collection's `findOne` resolves to a stored `subscriptionId` so the
 * upstream-cancel port is exercised; the `profiles` collection's `findOne`
 * resolves to a stored `avatarUrl` so the avatar-file unlink is exercised; the
 * `find(...).sort(...).limit(...).toArray()` chain (used by the export) resolves
 * to an empty page; all writes resolve successfully.
 */
function connectionStub(
  subscriptionId: string | null = 'sub_123',
  avatarUrl: string | null = '/uploads/avatars/abc-123.webp',
): {
  connection: Connection;
  collection: jest.Mock;
  byName: Record<string, Record<string, jest.Mock>>;
} {
  const byName: Record<string, Record<string, jest.Mock>> = {};
  const collection = jest.fn((name: string) => {
    if (!byName[name]) {
      // Chainable find().sort().limit().toArray() used by exportAccount.
      const cursor = {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([]),
      };
      byName[name] = {
        findOne: jest.fn().mockResolvedValue(
          name === 'subscriptions'
            ? { subscriptionId }
            : name === 'profiles'
              ? { avatarUrl }
              : null,
        ),
        find: jest.fn(() => cursor),
        updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
        updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
        deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
        insertOne: jest.fn().mockResolvedValue({ insertedId: new Types.ObjectId() }),
      };
    }
    return byName[name];
  });
  return { connection: { collection } as unknown as Connection, collection, byName };
}

/** An {@link AvatarStorageService} whose `deleteByUrl` is a resolved mock. */
function avatarStorageStub(): AvatarStorageService & { deleteByUrl: jest.Mock } {
  return {
    deleteByUrl: jest.fn().mockResolvedValue(undefined),
  } as unknown as AvatarStorageService & { deleteByUrl: jest.Mock };
}

/** A live (not-yet-erased) user document whose `save()` is a resolved mock. */
function liveUserDoc(): UserDocument & { save: jest.Mock } {
  return {
    _id: new Types.ObjectId(USER_ID),
    email: 'a@b.io',
    phone: null,
    role: 'user',
    isBanned: false,
    deletedAt: null,
    save: jest.fn().mockResolvedValue(undefined),
  } as unknown as UserDocument & { save: jest.Mock };
}

describe('UsersService.eraseAccount — billing/feed teardown', () => {
  it('cancels the upstream subscription and drives local billing/feed teardown', async () => {
    const userDoc = liveUserDoc();
    const userModel = {
      findById: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(userDoc) })),
    } as unknown as Model<UserDocument>;
    const { connection, byName } = connectionStub('sub_123');
    const cancelSubscription = jest.fn().mockResolvedValue(undefined);
    const port: PaymentsCancelPort = { cancelSubscription };

    const service = new UsersService(userModel, connection, port);
    const res = await service.eraseAccount(USER_ID);

    expect(res.erased).toBe(true);
    // The credential row was tombstoned (deletedAt + isBanned) and saved.
    expect(userDoc.save).toHaveBeenCalledTimes(1);
    expect(userDoc.deletedAt).toBeInstanceOf(Date);
    expect(userDoc.isBanned).toBe(true);

    // Billing cancel: the upstream subscription is cancelled by its stored id…
    expect(cancelSubscription).toHaveBeenCalledWith('sub_123');
    // …and the local subscription row is driven to a terminal, non-billing state.
    expect(byName.subscriptions?.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'none',
          cancelAtPeriodEnd: false,
          token: null,
          subscriptionId: null,
        }),
      }),
    );

    // Permanent erasure zeroes the forfeit wallet balance…
    expect(byName.wallets?.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $set: expect.objectContaining({ balanceCoins: 0 }) }),
    );
    // …and expires any active paid Top placement.
    expect(byName.topplacements?.updateMany).toHaveBeenCalledTimes(1);
  });

  it('a teardown failure NEVER aborts the erasure (best-effort)', async () => {
    const userDoc = liveUserDoc();
    const userModel = {
      findById: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(userDoc) })),
    } as unknown as Model<UserDocument>;
    const { connection } = connectionStub('sub_123');
    // The upstream cancel throws — must be swallowed, erasure still succeeds.
    const port: PaymentsCancelPort = {
      cancelSubscription: jest.fn().mockRejectedValue(new Error('provider down')),
    };

    const service = new UsersService(userModel, connection, port);

    await expect(service.eraseAccount(USER_ID)).resolves.toMatchObject({ erased: true });
    expect(userDoc.save).toHaveBeenCalledTimes(1);
  });

  it('is an idempotent no-op on an already-erased account (no teardown)', async () => {
    const userDoc = liveUserDoc();
    userDoc.deletedAt = new Date();
    const userModel = {
      findById: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(userDoc) })),
    } as unknown as Model<UserDocument>;
    const { connection, collection } = connectionStub('sub_123');
    const cancelSubscription = jest.fn().mockResolvedValue(undefined);

    const service = new UsersService(userModel, connection, { cancelSubscription });
    const res = await service.eraseAccount(USER_ID);

    expect(res.erased).toBe(false);
    expect(userDoc.save).not.toHaveBeenCalled();
    expect(cancelSubscription).not.toHaveBeenCalled();
    expect(collection).not.toHaveBeenCalled();
  });
});

describe('UsersService.eraseAccount — long-tail PII scrub (right-to-be-forgotten)', () => {
  it('unlinks the avatar FILE and scrubs every additional PII collection', async () => {
    const userDoc = liveUserDoc();
    const userModel = {
      findById: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(userDoc) })),
    } as unknown as Model<UserDocument>;
    const { connection, byName } = connectionStub('sub_123', '/uploads/avatars/abc-123.webp');
    const avatarStorage = avatarStorageStub();

    const service = new UsersService(userModel, connection, undefined, avatarStorage);
    const res = await service.eraseAccount(USER_ID);

    expect(res.erased).toBe(true);

    // (a) The avatar URL is read from the profile BEFORE it is nulled, then the
    //     on-disk file is unlinked via deleteByUrl with that exact URL.
    expect(byName.profiles?.findOne).toHaveBeenCalledWith(
      { userId: expect.anything() },
      { projection: { avatarUrl: 1 } },
    );
    expect(avatarStorage.deleteByUrl).toHaveBeenCalledWith('/uploads/avatars/abc-123.webp');

    // (b) Push routing identifiers are deleted.
    expect(byName.device_tokens?.deleteMany).toHaveBeenCalledWith({ userId: expect.anything() });
    expect(byName.push_subscriptions?.deleteMany).toHaveBeenCalledWith({
      userId: expect.anything(),
    });

    // (c) Authored gift notes + authored reports are redacted.
    expect(byName.gifttransactions?.updateMany).toHaveBeenCalledWith(
      { fromUserId: expect.anything() },
      { $set: { message: null } },
    );
    expect(byName.reports?.updateMany).toHaveBeenCalledWith(
      { fromUserId: expect.anything() },
      { $set: { details: null, evidenceUrl: null } },
    );

    // (d) The user's own moderation-evidence frames are nulled (row retained).
    expect(byName.moderation_events?.updateMany).toHaveBeenCalledWith(
      { userId: expect.anything() },
      { $set: { evidenceUrl: null } },
    );
  });

  it('tolerates a missing AvatarStorageService (file unlink skipped, erasure succeeds)', async () => {
    const userDoc = liveUserDoc();
    const userModel = {
      findById: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(userDoc) })),
    } as unknown as Model<UserDocument>;
    const { connection } = connectionStub('sub_123');

    // No avatarStorage passed — the unlink is simply skipped, scrub still runs.
    const service = new UsersService(userModel, connection);
    await expect(service.eraseAccount(USER_ID)).resolves.toMatchObject({ erased: true });
  });

  it('a failed avatar unlink NEVER aborts the erasure (best-effort)', async () => {
    const userDoc = liveUserDoc();
    const userModel = {
      findById: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(userDoc) })),
    } as unknown as Model<UserDocument>;
    const { connection } = connectionStub('sub_123');
    const avatarStorage = avatarStorageStub();
    avatarStorage.deleteByUrl.mockRejectedValue(new Error('EACCES'));

    const service = new UsersService(userModel, connection, undefined, avatarStorage);
    await expect(service.eraseAccount(USER_ID)).resolves.toMatchObject({ erased: true });
    expect(userDoc.save).toHaveBeenCalledTimes(1);
  });
});

describe('UsersService.exportAccount — data access / portability', () => {
  /** A user model whose lean findById resolves to a doc carrying a passwordHash. */
  function exportUserModel(doc: Record<string, unknown> | null): Model<UserDocument> {
    return {
      findById: jest.fn(() => ({
        lean: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(doc) })),
      })),
    } as unknown as Model<UserDocument>;
  }

  it('assembles the caller bundle, strips the passwordHash, and audit-logs the access', async () => {
    const userModel = exportUserModel({
      _id: new Types.ObjectId(USER_ID),
      email: 'a@b.io',
      passwordHash: 'argon2-secret',
      role: 'user',
    });
    const { connection, byName } = connectionStub();

    const service = new UsersService(userModel, connection);
    const bundle = await service.exportAccount(USER_ID);

    // The credential row is present but the secret is gone.
    expect(bundle.user).toMatchObject({ email: 'a@b.io', role: 'user' });
    expect(bundle.user).not.toHaveProperty('passwordHash');

    // Every advertised collection is represented (bounded shape).
    expect(bundle.messages).toEqual({ items: [], truncated: false });
    expect(bundle.payments).toEqual({ items: [], truncated: false });
    expect(bundle.reportsFiled).toEqual({ items: [], truncated: false });
    expect(bundle.friendships).toEqual({ items: [], truncated: false });
    expect(bundle.recordCap).toBeGreaterThan(0);
    expect(typeof bundle.exportedAt).toBe('string');

    // The access is durably audit-logged (append-only admin_audit_logs).
    expect(byName.admin_audit_logs?.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.data_export', targetType: 'user', targetId: USER_ID }),
    );
  });

  it('sessions are exported WITHOUT their secret token hashes', async () => {
    const userModel = exportUserModel({ _id: new Types.ObjectId(USER_ID), email: 'a@b.io' });
    const { connection, byName } = connectionStub();
    // Make the sessions cursor yield a row carrying secret hashes.
    byName.sessions = undefined as never;
    const service = new UsersService(userModel, connection);
    // Re-stub the sessions collection's cursor to return a secret-bearing row.
    const sessionsCursor = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest
        .fn()
        .mockResolvedValue([{ userId: USER_ID, tokenHash: 'secret', replacedByHash: 'secret2', ip: '1.2.3.4' }]),
    };
    (connection.collection as unknown as jest.Mock).mockImplementation((name: string) => {
      if (name === 'sessions') {
        return { find: jest.fn(() => sessionsCursor) };
      }
      const cursor = {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([]),
      };
      return {
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn(() => cursor),
        insertOne: jest.fn().mockResolvedValue({}),
      };
    });

    const bundle = await service.exportAccount(USER_ID);
    const session = bundle.sessions.items[0] as Record<string, unknown>;
    expect(session).toBeDefined();
    expect(session).not.toHaveProperty('tokenHash');
    expect(session).not.toHaveProperty('replacedByHash');
    // Non-secret context is retained.
    expect(session).toMatchObject({ ip: '1.2.3.4' });
  });

  it('returns empty/null fields for an invalid user id (no crash)', async () => {
    const userModel = exportUserModel(null);
    const { connection } = connectionStub();
    const service = new UsersService(userModel, connection);

    const bundle = await service.exportAccount('not-an-objectid');
    expect(bundle.user).toBeNull();
    expect(bundle.profile).toBeNull();
    expect(bundle.messages).toEqual({ items: [], truncated: false });
  });
});
