import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import { ReviewService } from './review.service';
import { ModerationEvent } from './schemas/moderation-event.schema';

/** Chainable query stub whose `.exec()` resolves to `result`. */
function queryReturning(result: unknown): { exec: jest.Mock } {
  return { exec: jest.fn().mockResolvedValue(result) };
}

/** A chainable `find().sort().limit().exec()` stub resolving to `rows`. */
function findChain(rows: unknown[]): Record<string, jest.Mock> {
  const chain: Record<string, jest.Mock> = {
    sort: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    exec: jest.fn().mockResolvedValue(rows),
  };
  return chain;
}

const USER = '507f1f77bcf86cd799439011';

/** Minimal hydrated moderation-event stub the service maps via `toContract`. */
function eventDoc(
  id: string,
  over: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    _id: { toString: () => id },
    userId: { toString: () => USER },
    matchId: null,
    label: 'nudity',
    score: 0.7,
    evidenceUrl: null,
    autoAction: 'warn',
    status: 'open',
    get: (_k: string) => new Date('2026-05-31T00:00:00.000Z'),
    ...over,
  };
}

describe('ReviewService — admin review queue', () => {
  let service: ReviewService;
  let eventModel: { find: jest.Mock; findByIdAndUpdate: jest.Mock };

  beforeEach(async () => {
    eventModel = { find: jest.fn(), findByIdAndUpdate: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReviewService,
        { provide: getModelToken(ModerationEvent.name), useValue: eventModel },
      ],
    }).compile();

    service = moduleRef.get(ReviewService);
  });

  it('listQueue: maps rows to ReviewItem and reports hasMore=false under the limit', async () => {
    eventModel.find.mockReturnValue(findChain([eventDoc('e1'), eventDoc('e2')]));

    const page = await service.listQueue({ cursor: undefined, limit: 20 });

    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({ id: 'e1', userId: USER, label: 'nudity' });
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('listQueue: trims the extra row and emits a cursor when hasMore', async () => {
    // limit 1 + one extra row signals another page.
    eventModel.find.mockReturnValue(findChain([eventDoc('e1'), eventDoc('e2')]));

    const page = await service.listQueue({ cursor: undefined, limit: 1 });

    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('e1');
  });

  it('listQueue: an invalid cursor yields an empty terminal page (no DB hit)', async () => {
    const page = await service.listQueue({ cursor: 'not-an-id', limit: 20 });

    expect(page).toEqual({ items: [], nextCursor: null, hasMore: false });
    expect(eventModel.find).not.toHaveBeenCalled();
  });

  it('resolve: upholds (resolved) an item and returns the updated ReviewItem', async () => {
    eventModel.findByIdAndUpdate.mockReturnValue(
      queryReturning(eventDoc('507f1f77bcf86cd799439012', { status: 'resolved' })),
    );

    const item = await service.resolve('507f1f77bcf86cd799439012', 'resolved');

    expect(item.status).toBe('resolved');
    const [, update] = eventModel.findByIdAndUpdate.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(update).toEqual({ $set: { status: 'resolved' } });
  });

  it('resolve: rejects a non-terminal status', async () => {
    await expect(
      service.resolve('507f1f77bcf86cd799439012', 'open' as 'resolved'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(eventModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('resolve: 404s an unknown id', async () => {
    eventModel.findByIdAndUpdate.mockReturnValue(queryReturning(null));

    await expect(service.resolve('507f1f77bcf86cd799439012', 'dismissed')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('resolve: 404s an invalid (non-ObjectId) id without hitting the DB', async () => {
    await expect(service.resolve('nope', 'resolved')).rejects.toBeInstanceOf(NotFoundException);
    expect(eventModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});
