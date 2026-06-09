import { Types } from 'mongoose';

import type { Connection, Model } from 'mongoose';

import type { PaymentsCancelPort } from '../../common/payments-cancel.port';
import { UsersService } from './users.service';
import type { UserDocument } from './schemas/user.schema';

const USER_ID = '507f1f77bcf86cd799439011';

/**
 * A `connection` whose `collection(name)` returns a fresh stub exposing every
 * method the erase + teardown paths touch. The `subscriptions` collection's
 * `findOne` resolves to a stored `subscriptionId` so the upstream-cancel port
 * is exercised; all writes resolve successfully.
 */
function connectionStub(subscriptionId: string | null = 'sub_123'): {
  connection: Connection;
  collection: jest.Mock;
  byName: Record<string, Record<string, jest.Mock>>;
} {
  const byName: Record<string, Record<string, jest.Mock>> = {};
  const collection = jest.fn((name: string) => {
    if (!byName[name]) {
      byName[name] = {
        findOne: jest.fn().mockResolvedValue(
          name === 'subscriptions' ? { subscriptionId } : null,
        ),
        updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
        updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
        deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      };
    }
    return byName[name];
  });
  return { connection: { collection } as unknown as Connection, collection, byName };
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
