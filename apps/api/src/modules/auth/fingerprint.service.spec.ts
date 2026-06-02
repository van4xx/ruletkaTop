import { createHash } from 'node:crypto';

import { FingerprintService } from './fingerprint.service';

/**
 * FingerprintService unit tests.
 *
 * Instantiated directly with typed Mongoose-model mocks (chainable
 * `.find()/.findOne().select().lean().exec()` shapes mirroring the rest of the
 * API's specs). No database is required.
 */

const USER_ID = '507f1f77bcf86cd799439011';

/** The hash the service should produce for a given ip|userAgent. */
function expectedFingerprint(ip: string, ua: string): string {
  return createHash('sha256').update(`${ip}|${ua}`).digest('hex');
}

/** A `findOne(...).lean().exec()` chain resolving to `result`. */
function findOneLeanReturning(result: unknown) {
  return {
    findOne: jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(result) }),
    }),
  };
}

interface Mocks {
  bannedFingerprintModel: {
    findOne: jest.Mock;
    updateOne: jest.Mock;
    find: jest.Mock;
  };
  sessionModel: { find: jest.Mock };
}

function buildMocks(): Mocks {
  return {
    bannedFingerprintModel: {
      findOne: jest.fn(),
      updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
      find: jest.fn(),
    },
    sessionModel: {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
    },
  };
}

function makeService(m: Mocks): FingerprintService {
  return new FingerprintService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m.bannedFingerprintModel as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m.sessionModel as any,
  );
}

describe('FingerprintService.compute', () => {
  it('is stable and order-sensitive for the same ip + userAgent', () => {
    const m = buildMocks();
    const service = makeService(m);
    const a = service.compute({ ip: '1.2.3.4', userAgent: 'UA/1' });
    const b = service.compute({ ip: '1.2.3.4', userAgent: 'UA/1' });
    expect(a).toBe(b);
    expect(a).toBe(expectedFingerprint('1.2.3.4', 'UA/1'));
  });

  it('returns null when there is neither IP nor User-Agent (insufficient signal)', () => {
    const m = buildMocks();
    const service = makeService(m);
    expect(service.compute({})).toBeNull();
    expect(service.compute({ ip: '', userAgent: '' })).toBeNull();
    expect(service.compute({ ip: null, userAgent: null })).toBeNull();
  });

  it('produces a fingerprint when only one of IP / UA is present', () => {
    const m = buildMocks();
    const service = makeService(m);
    expect(service.compute({ ip: '1.2.3.4' })).toBe(expectedFingerprint('1.2.3.4', ''));
    expect(service.compute({ userAgent: 'UA/1' })).toBe(expectedFingerprint('', 'UA/1'));
  });
});

describe('FingerprintService.isBanned', () => {
  it('returns true when an ACTIVE banned-fingerprint row matches the context', async () => {
    const m = buildMocks();
    Object.assign(m.bannedFingerprintModel, findOneLeanReturning({ _id: 'row' }));
    const service = makeService(m);

    await expect(
      service.isBanned({ ip: '5.5.5.5', userAgent: 'evader' }),
    ).resolves.toBe(true);

    // Looked up by the computed hash, filtering to active (permanent or unexpired).
    const [query] = m.bannedFingerprintModel.findOne.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(query.fingerprint).toBe(expectedFingerprint('5.5.5.5', 'evader'));
    expect(query.$or).toBeDefined();
  });

  it('returns false when no row matches', async () => {
    const m = buildMocks();
    Object.assign(m.bannedFingerprintModel, findOneLeanReturning(null));
    const service = makeService(m);
    await expect(
      service.isBanned({ ip: '1.2.3.4', userAgent: 'clean' }),
    ).resolves.toBe(false);
  });

  it('returns false (skips the gate) when the context cannot be fingerprinted', async () => {
    const m = buildMocks();
    const service = makeService(m);
    await expect(service.isBanned({})).resolves.toBe(false);
    expect(m.bannedFingerprintModel.findOne).not.toHaveBeenCalled();
  });

  it('fails OPEN (returns false) on a storage error', async () => {
    const m = buildMocks();
    m.bannedFingerprintModel.findOne.mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error('mongo down')),
      }),
    });
    const service = makeService(m);
    await expect(
      service.isBanned({ ip: '5.5.5.5', userAgent: 'evader' }),
    ).resolves.toBe(false);
  });
});

describe('FingerprintService.recordForUser', () => {
  it('upserts a fingerprint for every distinct session ip/UA plus the current context', async () => {
    const m = buildMocks();
    // Two sessions (one duplicate of the explicit context) → 2 distinct hashes.
    m.sessionModel.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        { ip: '1.1.1.1', userAgent: 'UA-A' },
        { ip: '2.2.2.2', userAgent: 'UA-B' },
      ]),
    });
    const service = makeService(m);

    await service.recordForUser(USER_ID, {
      context: { ip: '1.1.1.1', userAgent: 'UA-A' }, // duplicate of session #1
    });

    // Distinct fingerprints: {1.1.1.1|UA-A, 2.2.2.2|UA-B} → 2 upserts.
    expect(m.bannedFingerprintModel.updateOne).toHaveBeenCalledTimes(2);
    const calls = m.bannedFingerprintModel.updateOne.mock.calls as Array<
      [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>]
    >;
    const fingerprints = calls.map((c) => c[0].fingerprint);
    expect(new Set(fingerprints)).toEqual(
      new Set([
        expectedFingerprint('1.1.1.1', 'UA-A'),
        expectedFingerprint('2.2.2.2', 'UA-B'),
      ]),
    );
    // Each is an upsert tying the row to the banned user.
    for (const [, update, options] of calls) {
      expect(options.upsert).toBe(true);
      expect((update.$set as { userId: unknown }).userId).toBeDefined();
    }
  });

  it('does nothing when there are no fingerprints to record', async () => {
    const m = buildMocks(); // sessions default to [] and no context supplied
    const service = makeService(m);
    await service.recordForUser(USER_ID);
    expect(m.bannedFingerprintModel.updateOne).not.toHaveBeenCalled();
  });

  it('ignores an invalid user id', async () => {
    const m = buildMocks();
    const service = makeService(m);
    await service.recordForUser('not-an-objectid', {
      context: { ip: '1.1.1.1', userAgent: 'UA' },
    });
    expect(m.sessionModel.find).not.toHaveBeenCalled();
    expect(m.bannedFingerprintModel.updateOne).not.toHaveBeenCalled();
  });

  it('never throws on a storage error (best-effort)', async () => {
    const m = buildMocks();
    m.sessionModel.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockRejectedValue(new Error('mongo down')),
    });
    const service = makeService(m);
    await expect(
      service.recordForUser(USER_ID, { context: { ip: '1.1.1.1', userAgent: 'UA' } }),
    ).resolves.toBeUndefined();
  });
});
