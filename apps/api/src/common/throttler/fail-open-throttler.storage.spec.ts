import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

import { FailOpenThrottlerStorage } from './fail-open-throttler.storage';

/**
 * FailOpenThrottlerStorage unit tests.
 *
 * The wrapper exists so a Redis outage degrades the throttler to "allow + log"
 * instead of 500-ing every request. We instantiate it directly around a typed
 * mock inner storage (the second instantiation style the project allows) and
 * silence the Nest Logger so a sustained-outage WARN doesn't spam the suite.
 */
const UP_RECORD: ThrottlerStorageRecord = {
  totalHits: 3,
  timeToExpire: 60_000,
  isBlocked: false,
  timeToBlockExpire: 0,
};

function makeInner(impl: ThrottlerStorage['increment']): ThrottlerStorage {
  return { increment: jest.fn(impl) };
}

describe('FailOpenThrottlerStorage', () => {
  beforeEach(() => {
    // Quieten the WARN emitted on the fail-open path.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes through the inner record verbatim when the store succeeds', async () => {
    const inner = makeInner(async () => UP_RECORD);
    const storage = new FailOpenThrottlerStorage(inner);

    const record = await storage.increment('ip:1', 60_000, 10, 0, 'default');

    expect(record).toEqual(UP_RECORD);
    expect(inner.increment).toHaveBeenCalledWith('ip:1', 60_000, 10, 0, 'default');
    expect(storage.failOpenEvents).toBe(0);
  });

  it('FAILS OPEN (allow, not blocked, zero hits) when the inner store throws', async () => {
    const inner = makeInner(async () => {
      throw new Error('ECONNREFUSED 127.0.0.1:6379');
    });
    const storage = new FailOpenThrottlerStorage(inner);

    const record = await storage.increment('ip:1', 60_000, 10, 0, 'default');

    // Synthesised "under limit, not blocked" record → the guard lets the request
    // through instead of bubbling a 500.
    expect(record).toEqual({
      totalHits: 0,
      timeToExpire: 60_000,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(storage.failOpenEvents).toBe(1);
  });

  it('counts every fail-open event during a sustained outage', async () => {
    const inner = makeInner(async () => {
      throw new Error('Connection is closed.');
    });
    const storage = new FailOpenThrottlerStorage(inner);

    await storage.increment('ip:1', 60_000, 10, 0, 'default');
    await storage.increment('ip:2', 60_000, 10, 0, 'default');
    await storage.increment('ip:3', 60_000, 10, 0, 'default');

    expect(storage.failOpenEvents).toBe(3);
  });

  it('recovers transparently: a later successful increment returns the real record', async () => {
    let fail = true;
    const inner = makeInner(async () => {
      if (fail) throw new Error('redis down');
      return UP_RECORD;
    });
    const storage = new FailOpenThrottlerStorage(inner);

    const duringOutage = await storage.increment('ip:1', 60_000, 10, 0, 'default');
    expect(duringOutage.totalHits).toBe(0);

    fail = false;
    const afterRecovery = await storage.increment('ip:1', 60_000, 10, 0, 'default');
    expect(afterRecovery).toEqual(UP_RECORD);
    expect(storage.failOpenEvents).toBe(1);
  });

  it('throttles error logging to one line per interval during an outage', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const inner = makeInner(async () => {
      throw new Error('redis down');
    });
    const storage = new FailOpenThrottlerStorage(inner);

    // A burst within the same interval should log exactly once.
    await storage.increment('ip:1', 60_000, 10, 0, 'default');
    await storage.increment('ip:2', 60_000, 10, 0, 'default');
    await storage.increment('ip:3', 60_000, 10, 0, 'default');

    expect(warn).toHaveBeenCalledTimes(1);
  });
});
