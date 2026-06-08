import type { Model } from 'mongoose';

import { MATCH_STALE_AFTER_MS, MatchService } from './match.service';
import type { MatchDocument } from './schemas/match.schema';

/** `updateMany(...).exec()` chain resolving to a Mongo write result. */
function updateManyReturning(modifiedCount: number): { exec: jest.Mock } {
  return { exec: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount }) };
}

interface Mocks {
  service: MatchService;
  matchModel: { create: jest.Mock; findOneAndUpdate: jest.Mock; updateMany: jest.Mock };
}

function makeService(): Mocks {
  const matchModel = {
    create: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateMany: jest.fn().mockReturnValue(updateManyReturning(0)),
  };
  const service = new MatchService(matchModel as unknown as Model<MatchDocument>);
  return { service, matchModel };
}

describe('MatchService.reconcileStale', () => {
  let m: Mocks;
  beforeEach(() => {
    m = makeService();
  });

  it('force-closes still-open matches older than the stale threshold (endReason=timeout)', async () => {
    m.matchModel.updateMany.mockReturnValue(updateManyReturning(3));
    const now = new Date('2026-06-08T12:00:00.000Z');

    const count = await m.service.reconcileStale(now);

    expect(count).toBe(3);
    const [filter, update] = m.matchModel.updateMany.mock.calls[0] as [
      Record<string, any>,
      Record<string, any>,
    ];
    // Only touches rows that are still live (endedAt null) AND past the cutoff.
    expect(filter.endedAt).toBeNull();
    const cutoff = filter.startedAt.$lte as Date;
    expect(cutoff.getTime()).toBe(now.getTime() - MATCH_STALE_AFTER_MS);
    // Stamps a terminal close so a swept row drops out of the next pass.
    expect(update.$set.endedAt).toBe(now);
    expect(update.$set.endReason).toBe('timeout');
  });

  it('returns 0 (no-op) when nothing is stale', async () => {
    m.matchModel.updateMany.mockReturnValue(updateManyReturning(0));

    const count = await m.service.reconcileStale(new Date());

    expect(count).toBe(0);
  });

  it('treats a missing modifiedCount as 0 reconciled', async () => {
    m.matchModel.updateMany.mockReturnValue({ exec: jest.fn().mockResolvedValue({}) });

    await expect(m.service.reconcileStale(new Date())).resolves.toBe(0);
  });

  it('uses a cutoff strictly in the past relative to now', async () => {
    const now = new Date();
    await m.service.reconcileStale(now);
    const [filter] = m.matchModel.updateMany.mock.calls[0] as [Record<string, any>];
    expect((filter.startedAt.$lte as Date).getTime()).toBeLessThan(now.getTime());
  });
});
