import { Types } from 'mongoose';

import type {
  GetStatusResult,
  KycProvider,
  ParseWebhookResult,
  StartVerificationResult,
} from './providers/kyc-provider.port';
import { KycService } from './kyc.service';

/**
 * KycService is a thin orchestrator around the {@link KycProvider} port; the
 * tests below verify each contract we promise the rest of the platform without
 * needing a live Mongo:
 *
 *   - "start" writes a `pending` row for SumSub/Veriff and stamps `Profile`
 *     only on `approved` (the noop path);
 *   - the webhook path verifies signature + status mapping AT THE ADAPTER, then
 *     marks the Profile when the parsed status is `approved`, using the
 *     decision timestamp FROM THE WEBHOOK BODY (no clock injection needed);
 *   - redelivered terminal webhooks are idempotent (no second Profile stamp);
 *   - a provider-name mismatch on the webhook path throws (forged URL);
 *   - `getMyVerification` projects the latest row + the Profile boolean.
 */

interface StoredRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  provider: 'sumsub' | 'veriff' | 'noop';
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  externalId: string;
  requestedAt: Date;
  decidedAt: Date | null;
  decisionMeta: Record<string, unknown> | null;
  save: jest.Mock;
}

interface StoredProfile {
  userId: Types.ObjectId;
  ageVerifiedAt: Date | null;
}

/** Build an in-memory KycModel substitute backed by an array. */
function buildKycModel() {
  const rows: StoredRow[] = [];
  const exec = <T>(value: T) => ({ exec: jest.fn().mockResolvedValue(value) });
  const sort = <T>(value: T) => ({
    sort: jest.fn().mockReturnValue({ ...exec(value), lean: jest.fn().mockReturnValue(exec(value)) }),
    ...exec(value),
    lean: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue(exec(value)),
      exec: jest.fn().mockResolvedValue(value),
    }),
  });

  const model = {
    rows,
    findOneAndUpdate: jest.fn((filter: { provider: string; externalId: string }, update: any) => {
      const idx = rows.findIndex(
        (r) => r.provider === filter.provider && r.externalId === filter.externalId,
      );
      const newStatus = update.$set?.status ?? 'pending';
      if (idx >= 0) {
        const existing = rows[idx]!;
        existing.status = newStatus;
        existing.decidedAt = update.$set?.decidedAt ?? existing.decidedAt;
        existing.decisionMeta = update.$set?.decisionMeta ?? existing.decisionMeta;
        return exec(existing);
      }
      const insert: StoredRow = {
        _id: new Types.ObjectId(),
        userId: update.$setOnInsert.userId,
        provider: update.$setOnInsert.provider,
        externalId: update.$setOnInsert.externalId,
        requestedAt: update.$setOnInsert.requestedAt,
        status: newStatus,
        decidedAt: update.$set?.decidedAt ?? null,
        decisionMeta: update.$set?.decisionMeta ?? null,
        save: jest.fn(),
      };
      rows.push(insert);
      return exec(insert);
    }),
    findOne: jest.fn((filter: { provider?: string; externalId?: string; userId?: Types.ObjectId }) => {
      if (filter.provider && filter.externalId) {
        const row = rows.find(
          (r) => r.provider === filter.provider && r.externalId === filter.externalId,
        );
        // save() mutates the row in place
        if (row) {
          row.save = jest.fn().mockImplementation(async () => row);
        }
        return exec(row ?? null);
      }
      if (filter.userId) {
        const userRows = rows
          .filter((r) => r.userId.toString() === (filter.userId as Types.ObjectId).toString())
          .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
        return sort(userRows[0] ?? null);
      }
      return exec(null);
    }),
  };
  return model;
}

/** Build an in-memory Profile model substitute. */
function buildProfileModel(initial: StoredProfile[] = []) {
  const profiles = [...initial];
  const exec = <T>(value: T) => ({ exec: jest.fn().mockResolvedValue(value) });
  const model = {
    profiles,
    findOne: jest.fn((filter: { userId: Types.ObjectId }) => {
      const row = profiles.find((p) => p.userId.toString() === filter.userId.toString());
      return {
        lean: jest.fn().mockReturnValue(exec(row ?? null)),
        exec: jest.fn().mockResolvedValue(row ?? null),
      };
    }),
    findOneAndUpdate: jest.fn((filter: any, update: any) => {
      const row = profiles.find((p) => p.userId.toString() === filter.userId.toString());
      if (!row) return exec(null);
      // Honor the `$or: [{ageVerifiedAt: null}, {ageVerifiedAt: { $exists: false }}]` guard.
      if (row.ageVerifiedAt === null) {
        row.ageVerifiedAt = update.$set.ageVerifiedAt;
      }
      return exec(row);
    }),
  };
  return model;
}

function buildProvider(name: 'sumsub' | 'veriff' | 'noop'): KycProvider & {
  startVerification: jest.Mock;
  parseWebhook: jest.Mock;
  getStatus: jest.Mock;
} {
  const startVerification = jest.fn(async (): Promise<StartVerificationResult> => ({
    externalId: `${name}-ext-1`,
    redirectUrl: `https://${name}.example/iframe/1`,
    expiresAt: Date.now() + 60_000,
  }));
  const parseWebhook = jest.fn(async (): Promise<ParseWebhookResult> => ({
    externalId: `${name}-ext-1`,
    status: 'approved',
    decisionMeta: { reviewAnswer: 'GREEN' },
    decidedAt: new Date('2026-06-01T10:00:00.000Z'),
  }));
  const getStatus = jest.fn(async (): Promise<GetStatusResult> => ({
    status: 'approved',
    decisionMeta: null,
  }));
  return {
    providerName: name,
    isConfigured: () => true,
    startVerification,
    parseWebhook,
    getStatus,
  };
}

function buildConfig(extra: Record<string, string> = {}) {
  return {
    get: jest.fn((key: string, def?: string) => extra[key] ?? def ?? ''),
  } as any;
}

describe('KycService.startVerification', () => {
  it('writes a pending row for sumsub and does NOT stamp Profile', async () => {
    const provider = buildProvider('sumsub');
    const userId = new Types.ObjectId();
    const profileModel = buildProfileModel([{ userId, ageVerifiedAt: null }]);
    const kycModel = buildKycModel();
    const svc = new KycService(
      provider,
      kycModel as any,
      profileModel as any,
      buildConfig(),
    );

    const out = await svc.startVerification(userId.toString());

    expect(out.status).toBe('pending');
    expect(out.provider).toBe('sumsub');
    expect(out.redirectUrl).toBe('https://sumsub.example/iframe/1');
    expect(kycModel.rows[0]?.status).toBe('pending');
    expect(profileModel.profiles[0]?.ageVerifiedAt).toBeNull();
  });

  it('AUTO-APPROVES on the noop adapter and stamps Profile.ageVerifiedAt', async () => {
    const provider = buildProvider('noop');
    const userId = new Types.ObjectId();
    const profileModel = buildProfileModel([{ userId, ageVerifiedAt: null }]);
    const kycModel = buildKycModel();
    const svc = new KycService(
      provider,
      kycModel as any,
      profileModel as any,
      buildConfig(),
    );

    const out = await svc.startVerification(userId.toString());

    expect(out.status).toBe('approved');
    expect(kycModel.rows[0]?.status).toBe('approved');
    expect(profileModel.profiles[0]?.ageVerifiedAt).toBeInstanceOf(Date);
  });

  it('rejects an invalid user id at the boundary', async () => {
    const provider = buildProvider('sumsub');
    const svc = new KycService(
      provider,
      buildKycModel() as any,
      buildProfileModel() as any,
      buildConfig(),
    );
    await expect(svc.startVerification('not-an-objectid')).rejects.toThrow();
  });
});

describe('KycService.handleWebhook', () => {
  it('stamps Profile.ageVerifiedAt to the provider decision timestamp on approved', async () => {
    const provider = buildProvider('sumsub');
    const userId = new Types.ObjectId();
    const profileModel = buildProfileModel([{ userId, ageVerifiedAt: null }]);
    const kycModel = buildKycModel();
    const svc = new KycService(
      provider,
      kycModel as any,
      profileModel as any,
      buildConfig(),
    );

    // Seed a pending row via the start path.
    await svc.startVerification(userId.toString());

    const headers = { 'x-payload-digest': 'whatever' };
    const result = await svc.handleWebhook('sumsub', headers, Buffer.from('{}'));

    expect(result).toEqual({ ok: true, status: 'approved' });
    // The Profile.ageVerifiedAt MUST equal the webhook's decidedAt (not Date.now()).
    expect(profileModel.profiles[0]?.ageVerifiedAt?.toISOString()).toBe(
      '2026-06-01T10:00:00.000Z',
    );
  });

  it('is IDEMPOTENT on a redelivered approved webhook (no second stamp move)', async () => {
    const provider = buildProvider('sumsub');
    const userId = new Types.ObjectId();
    const profileModel = buildProfileModel([{ userId, ageVerifiedAt: null }]);
    const kycModel = buildKycModel();
    const svc = new KycService(
      provider,
      kycModel as any,
      profileModel as any,
      buildConfig(),
    );

    await svc.startVerification(userId.toString());
    await svc.handleWebhook('sumsub', { 'x-payload-digest': 'a' }, Buffer.from('{}'));
    const firstStamp = profileModel.profiles[0]?.ageVerifiedAt?.toISOString();

    // Provider replays the SAME decision (same externalId, same status, same ts).
    await svc.handleWebhook('sumsub', { 'x-payload-digest': 'a' }, Buffer.from('{}'));
    // The Profile stamp stays put (the guarded $set only writes when null).
    expect(profileModel.profiles[0]?.ageVerifiedAt?.toISOString()).toBe(firstStamp);
  });

  it('REFUSES a webhook with a provider name different from the active provider', async () => {
    const provider = buildProvider('sumsub');
    const svc = new KycService(
      provider,
      buildKycModel() as any,
      buildProfileModel() as any,
      buildConfig(),
    );
    await expect(
      svc.handleWebhook('veriff', {}, Buffer.from('{}')),
    ).rejects.toThrow(/provider mismatch/);
  });

  it('throws 404 for an unknown externalId (suspicious / forged)', async () => {
    const provider = buildProvider('sumsub');
    // parseWebhook returns an externalId that was never created via start.
    provider.parseWebhook.mockResolvedValueOnce({
      externalId: 'never-existed',
      status: 'approved',
      decisionMeta: {},
      decidedAt: new Date(),
    });
    const svc = new KycService(
      provider,
      buildKycModel() as any,
      buildProfileModel() as any,
      buildConfig(),
    );
    await expect(
      svc.handleWebhook('sumsub', {}, Buffer.from('{}')),
    ).rejects.toThrow();
  });
});

describe('KycService.getMyVerification', () => {
  it('projects ageVerified=false + the latest row when present', async () => {
    const provider = buildProvider('sumsub');
    const userId = new Types.ObjectId();
    const profileModel = buildProfileModel([{ userId, ageVerifiedAt: null }]);
    const kycModel = buildKycModel();
    const svc = new KycService(
      provider,
      kycModel as any,
      profileModel as any,
      buildConfig(),
    );
    await svc.startVerification(userId.toString());

    const me = await svc.getMyVerification(userId.toString());
    expect(me.ageVerified).toBe(false);
    expect(me.verification?.provider).toBe('sumsub');
    expect(me.verification?.status).toBe('pending');
  });

  it('projects ageVerified=true and null verification for a freshly-created profile without a row', async () => {
    const provider = buildProvider('sumsub');
    const userId = new Types.ObjectId();
    const profileModel = buildProfileModel([
      { userId, ageVerifiedAt: new Date('2026-01-01T00:00:00.000Z') },
    ]);
    const svc = new KycService(
      provider,
      buildKycModel() as any,
      profileModel as any,
      buildConfig(),
    );
    const me = await svc.getMyVerification(userId.toString());
    expect(me.ageVerified).toBe(true);
    expect(me.verification).toBeNull();
  });
});
