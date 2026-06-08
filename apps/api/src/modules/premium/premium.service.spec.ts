import type { Connection, Model } from 'mongoose';

import type { CloudPaymentsClient } from '../payments/cloudpayments.client';
import { PremiumService } from './premium.service';
import type { PremiumPlanDocument } from './schemas/premium-plan.schema';
import type { SubscriptionDocument } from './schemas/subscription.schema';

const userId = '507f1f77bcf86cd799439011';

/** `findOne(...).select(...).lean().exec()` chain resolving to `doc`. */
function selectLeanReturning(doc: unknown): {
  select: jest.Mock;
  lean: jest.Mock;
  exec: jest.Mock;
} {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(doc),
  };
}

/** `findOneAndUpdate(...).select(...).exec()` chain resolving to `doc`. */
function findOneAndUpdateSelectReturning(doc: unknown): {
  select: jest.Mock;
  exec: jest.Mock;
} {
  return {
    select: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(doc),
  };
}

/** `updateOne(...).exec()` chain. */
function updateOneReturning(): { exec: jest.Mock } {
  return { exec: jest.fn().mockResolvedValue({ acknowledged: true }) };
}

interface Mocks {
  service: PremiumService;
  planModel: { findOne: jest.Mock; find: jest.Mock; updateOne: jest.Mock };
  subscriptionModel: {
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
    updateOne: jest.Mock;
    updateMany: jest.Mock;
    find: jest.Mock;
  };
  profilesCollection: { updateOne: jest.Mock };
  connection: { collection: jest.Mock };
  cloudPayments: { isConfigured: jest.Mock; cancelSubscription: jest.Mock };
}

function makeService(): Mocks {
  const planModel = {
    findOne: jest.fn(),
    find: jest.fn(),
    updateOne: jest.fn().mockReturnValue(updateOneReturning()),
  };
  const subscriptionModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn().mockReturnValue(updateOneReturning()),
    updateMany: jest.fn().mockReturnValue(updateOneReturning()),
    find: jest.fn(),
  };
  const profilesCollection = { updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }) };
  const connection = { collection: jest.fn().mockReturnValue(profilesCollection) };
  const cloudPayments = {
    isConfigured: jest.fn().mockReturnValue(false),
    cancelSubscription: jest.fn().mockResolvedValue(undefined),
  };

  const service = new PremiumService(
    planModel as unknown as Model<PremiumPlanDocument>,
    subscriptionModel as unknown as Model<SubscriptionDocument>,
    connection as unknown as Connection,
    cloudPayments as unknown as CloudPaymentsClient,
  );
  return { service, planModel, subscriptionModel, profilesCollection, connection, cloudPayments };
}

describe('PremiumService.isPremium', () => {
  let m: Mocks;
  beforeEach(() => {
    m = makeService();
  });

  it('is TRUE when status is active and currentPeriodEnd is in the future', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    m.subscriptionModel.findOne.mockReturnValue(
      selectLeanReturning({ status: 'active', currentPeriodEnd: future }),
    );

    await expect(m.service.isPremium(userId)).resolves.toBe(true);
  });

  it('is FALSE when active but the period has already ended', async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000);
    m.subscriptionModel.findOne.mockReturnValue(
      selectLeanReturning({ status: 'active', currentPeriodEnd: past }),
    );

    await expect(m.service.isPremium(userId)).resolves.toBe(false);
  });

  it('is FALSE when the period is in the future but the status is not active', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    m.subscriptionModel.findOne.mockReturnValue(
      selectLeanReturning({ status: 'canceled', currentPeriodEnd: future }),
    );

    await expect(m.service.isPremium(userId)).resolves.toBe(false);
  });

  it('is FALSE when currentPeriodEnd is null (never subscribed)', async () => {
    m.subscriptionModel.findOne.mockReturnValue(
      selectLeanReturning({ status: 'active', currentPeriodEnd: null }),
    );

    await expect(m.service.isPremium(userId)).resolves.toBe(false);
  });

  it('is FALSE when no subscription document exists', async () => {
    m.subscriptionModel.findOne.mockReturnValue(selectLeanReturning(null));

    await expect(m.service.isPremium(userId)).resolves.toBe(false);
  });

  it('is FALSE (and never queries) for an invalid userId', async () => {
    await expect(m.service.isPremium('not-an-objectid')).resolves.toBe(false);
    expect(m.subscriptionModel.findOne).not.toHaveBeenCalled();
  });
});

describe('PremiumService.activate', () => {
  let m: Mocks;
  beforeEach(() => {
    m = makeService();
  });

  it('upserts the subscription to active for the paid period', async () => {
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await m.service.activate(userId, 'monthly', periodEnd, 'tok_123');

    // First updateOne is the upsert of the active subscription.
    const [filter, update, options] = m.subscriptionModel.updateOne.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, any>,
      Record<string, unknown>,
    ];
    expect(filter).toHaveProperty('userId');
    expect(update.$set).toMatchObject({
      plan: 'monthly',
      status: 'active',
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
    });
    // The recurring token is persisted when supplied.
    expect(update.$set.token).toBe('tok_123');
    expect(options).toMatchObject({ upsert: true });
  });

  it('omits the token from $set when none is supplied', async () => {
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await m.service.activate(userId, 'monthly', periodEnd);

    const [, update] = m.subscriptionModel.updateOne.mock.calls[0] as [
      unknown,
      Record<string, any>,
    ];
    expect(update.$set).not.toHaveProperty('token');
  });

  it('mirrors premium onto the profile (isPremium + premium badge) on activation', async () => {
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await m.service.activate(userId, 'monthly', periodEnd);

    expect(m.connection.collection).toHaveBeenCalledWith('profiles');
    expect(m.profilesCollection.updateOne).toHaveBeenCalledTimes(1);
    const [, profileUpdate] = m.profilesCollection.updateOne.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, any>,
    ];
    expect(profileUpdate.$set).toMatchObject({ isPremium: true, premiumUntil: periodEnd });
    expect(profileUpdate.$addToSet).toEqual({ badges: 'premium' });
  });

  it('does not let a profile-sync failure break activation (best-effort mirror)', async () => {
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    m.profilesCollection.updateOne.mockRejectedValue(new Error('profiles write failed'));

    // The authoritative subscription write succeeded; the mirror error is swallowed.
    await expect(m.service.activate(userId, 'monthly', periodEnd)).resolves.toBeUndefined();
    expect(m.subscriptionModel.updateOne).toHaveBeenCalled();
  });
});

describe('PremiumService.cancel', () => {
  let m: Mocks;
  beforeEach(() => {
    m = makeService();
  });

  it('flips status to canceled and flags cancelAtPeriodEnd', async () => {
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    m.subscriptionModel.findOneAndUpdate.mockReturnValue(
      findOneAndUpdateSelectReturning({ currentPeriodEnd: future }),
    );

    await m.service.cancel(userId);

    const [, update] = m.subscriptionModel.findOneAndUpdate.mock.calls[0] as [
      unknown,
      Record<string, any>,
    ];
    expect(update.$set).toMatchObject({ status: 'canceled', cancelAtPeriodEnd: true });
  });

  it('keeps the profile premium while the paid period is still in the future', async () => {
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    m.subscriptionModel.findOneAndUpdate.mockReturnValue(
      findOneAndUpdateSelectReturning({ currentPeriodEnd: future }),
    );

    await m.service.cancel(userId);

    const [, profileUpdate] = m.profilesCollection.updateOne.mock.calls[0] as [
      unknown,
      Record<string, any>,
    ];
    // Standard SaaS: access retained until period end, so still mirrored premium.
    expect(profileUpdate.$set).toMatchObject({ isPremium: true, premiumUntil: future });
    expect(profileUpdate.$addToSet).toEqual({ badges: 'premium' });
  });

  it('revokes the profile premium when the period has already lapsed', async () => {
    const past = new Date(Date.now() - 1000);
    m.subscriptionModel.findOneAndUpdate.mockReturnValue(
      findOneAndUpdateSelectReturning({ currentPeriodEnd: past }),
    );

    await m.service.cancel(userId);

    const [, profileUpdate] = m.profilesCollection.updateOne.mock.calls[0] as [
      unknown,
      Record<string, any>,
    ];
    expect(profileUpdate.$set).toMatchObject({ isPremium: false, premiumUntil: null });
    // The premium badge is pulled when entitlement is revoked.
    expect(profileUpdate.$pull).toEqual({ badges: 'premium' });
  });

  it('is a no-op (no DB call) for an invalid userId', async () => {
    await m.service.cancel('bad-id');
    expect(m.subscriptionModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(m.profilesCollection.updateOne).not.toHaveBeenCalled();
  });
});

describe('PremiumService.cancelAtPeriodEnd', () => {
  let m: Mocks;
  beforeEach(() => {
    m = makeService();
  });

  it('cancels the upstream CloudPayments subscription when configured + id present', async () => {
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    // findOne(...).select('+subscriptionId').lean().exec() → stored sub id.
    m.subscriptionModel.findOne.mockReturnValue(selectLeanReturning({ subscriptionId: 'sc_42' }));
    // cancel() then re-reads via findOneAndUpdate(...).select().exec().
    m.subscriptionModel.findOneAndUpdate.mockReturnValue(
      findOneAndUpdateSelectReturning({ currentPeriodEnd: future }),
    );
    m.cloudPayments.isConfigured.mockReturnValue(true);

    await m.service.cancelAtPeriodEnd(userId);

    expect(m.cloudPayments.cancelSubscription).toHaveBeenCalledWith('sc_42');
    // Local state still flipped to canceled (delegates to cancel()).
    const [, update] = m.subscriptionModel.findOneAndUpdate.mock.calls[0] as [
      unknown,
      Record<string, any>,
    ];
    expect(update.$set).toMatchObject({ status: 'canceled', cancelAtPeriodEnd: true });
  });

  it('still records local cancellation when the upstream cancel throws', async () => {
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    m.subscriptionModel.findOne.mockReturnValue(selectLeanReturning({ subscriptionId: 'sc_42' }));
    m.subscriptionModel.findOneAndUpdate.mockReturnValue(
      findOneAndUpdateSelectReturning({ currentPeriodEnd: future }),
    );
    m.cloudPayments.isConfigured.mockReturnValue(true);
    m.cloudPayments.cancelSubscription.mockRejectedValue(new Error('provider down'));

    await expect(m.service.cancelAtPeriodEnd(userId)).resolves.toBeUndefined();
    expect(m.subscriptionModel.findOneAndUpdate).toHaveBeenCalled(); // local cancel ran
  });

  it('skips the upstream call when no subscriptionId is stored', async () => {
    m.subscriptionModel.findOne.mockReturnValue(selectLeanReturning({ subscriptionId: null }));
    m.subscriptionModel.findOneAndUpdate.mockReturnValue(
      findOneAndUpdateSelectReturning({ currentPeriodEnd: null }),
    );
    m.cloudPayments.isConfigured.mockReturnValue(true);

    await m.service.cancelAtPeriodEnd(userId);
    expect(m.cloudPayments.cancelSubscription).not.toHaveBeenCalled();
  });

  it('is a no-op for an invalid userId', async () => {
    await m.service.cancelAtPeriodEnd('bad-id');
    expect(m.subscriptionModel.findOne).not.toHaveBeenCalled();
    expect(m.cloudPayments.cancelSubscription).not.toHaveBeenCalled();
  });
});

describe('PremiumService.hasCanceledRenewal', () => {
  let m: Mocks;
  beforeEach(() => {
    m = makeService();
  });

  it('is TRUE when cancelAtPeriodEnd is set', async () => {
    m.subscriptionModel.findOne.mockReturnValue(
      selectLeanReturning({ status: 'active', cancelAtPeriodEnd: true }),
    );
    await expect(m.service.hasCanceledRenewal(userId)).resolves.toBe(true);
  });

  it('is TRUE when status is canceled', async () => {
    m.subscriptionModel.findOne.mockReturnValue(
      selectLeanReturning({ status: 'canceled', cancelAtPeriodEnd: false }),
    );
    await expect(m.service.hasCanceledRenewal(userId)).resolves.toBe(true);
  });

  it('is FALSE for an active, non-cancelled subscription', async () => {
    m.subscriptionModel.findOne.mockReturnValue(
      selectLeanReturning({ status: 'active', cancelAtPeriodEnd: false }),
    );
    await expect(m.service.hasCanceledRenewal(userId)).resolves.toBe(false);
  });

  it('is FALSE when no record exists', async () => {
    m.subscriptionModel.findOne.mockReturnValue(selectLeanReturning(null));
    await expect(m.service.hasCanceledRenewal(userId)).resolves.toBe(false);
  });
});

describe('PremiumService.sweepExpired', () => {
  let m: Mocks;
  beforeEach(() => {
    m = makeService();
  });

  /** find(...).select(...).lean().exec() chain resolving to `docs`. */
  function findSelectLeanReturning(docs: unknown): {
    select: jest.Mock;
    lean: jest.Mock;
    exec: jest.Mock;
  } {
    return {
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(docs),
    };
  }

  it('expires lapsed subscriptions → none and revokes the profile mirror', async () => {
    const uid = { toString: () => userId };
    m.subscriptionModel.find.mockReturnValue(
      findSelectLeanReturning([{ _id: 'sub1', userId: uid }]),
    );

    const count = await m.service.sweepExpired(new Date());

    expect(count).toBe(1);
    // Transitioned to the non-entitled state.
    const [filter, update] = m.subscriptionModel.updateMany.mock.calls[0] as [
      Record<string, any>,
      Record<string, any>,
    ];
    expect(filter._id.$in).toEqual(['sub1']);
    expect(update.$set).toMatchObject({ status: 'none', cancelAtPeriodEnd: false });
    // Profile premium revoked.
    const [, profileUpdate] = m.profilesCollection.updateOne.mock.calls[0] as [
      unknown,
      Record<string, any>,
    ];
    expect(profileUpdate.$set).toMatchObject({ isPremium: false, premiumUntil: null });
    expect(profileUpdate.$pull).toEqual({ badges: 'premium' });
  });

  it('is a no-op when nothing has lapsed', async () => {
    m.subscriptionModel.find.mockReturnValue(findSelectLeanReturning([]));
    const count = await m.service.sweepExpired(new Date());
    expect(count).toBe(0);
    expect(m.subscriptionModel.updateMany).not.toHaveBeenCalled();
    expect(m.profilesCollection.updateOne).not.toHaveBeenCalled();
  });
});
