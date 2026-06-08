import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import { AdminService } from './admin.service';
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
    // `resolveWithBan` mutates `status` then persists via `save()`.
    save: jest.fn().mockImplementation(function (this: Record<string, unknown>) {
      return Promise.resolve(this);
    }),
    ...over,
  };
}

describe('ReviewService — admin review queue', () => {
  let service: ReviewService;
  let eventModel: { find: jest.Mock; findById: jest.Mock; findByIdAndUpdate: jest.Mock };
  let adminService: { banUser: jest.Mock; unbanUser: jest.Mock };

  beforeEach(async () => {
    eventModel = { find: jest.fn(), findById: jest.fn(), findByIdAndUpdate: jest.fn() };
    adminService = {
      banUser: jest.fn(),
      unbanUser: jest.fn().mockResolvedValue({ userId: USER, isBanned: false }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReviewService,
        { provide: getModelToken(ModerationEvent.name), useValue: eventModel },
        { provide: AdminService, useValue: adminService },
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
    const doc = eventDoc('507f1f77bcf86cd799439012', { autoAction: 'warn' });
    eventModel.findById.mockReturnValue(queryReturning(doc));

    const item = await service.resolve('507f1f77bcf86cd799439012', 'resolved');

    expect(item.status).toBe('resolved');
    expect(doc.status).toBe('resolved');
    expect(doc.save).toHaveBeenCalledTimes(1);
    // Upholding never reverses a sanction.
    expect(adminService.unbanUser).not.toHaveBeenCalled();
  });

  it('resolve: dismissing a BAN-autoaction item UNBANS the user (false-positive reversal)', async () => {
    const doc = eventDoc('507f1f77bcf86cd799439012', { autoAction: 'ban' });
    eventModel.findById.mockReturnValue(queryReturning(doc));

    const item = await service.resolve('507f1f77bcf86cd799439012', 'dismissed');

    // The auto-ban is reversed before the row is closed.
    expect(adminService.unbanUser).toHaveBeenCalledTimes(1);
    expect(adminService.unbanUser).toHaveBeenCalledWith(USER);
    expect(doc.status).toBe('dismissed');
    expect(item.status).toBe('dismissed');
  });

  it('resolve: dismissing a KICK-autoaction item also unbans (kick may co-occur with a ban)', async () => {
    const doc = eventDoc('507f1f77bcf86cd799439012', { autoAction: 'kick' });
    eventModel.findById.mockReturnValue(queryReturning(doc));

    await service.resolve('507f1f77bcf86cd799439012', 'dismissed');

    expect(adminService.unbanUser).toHaveBeenCalledWith(USER);
  });

  it('resolve: dismissing a non-sanction (warn) item does NOT unban', async () => {
    const doc = eventDoc('507f1f77bcf86cd799439012', { autoAction: 'warn' });
    eventModel.findById.mockReturnValue(queryReturning(doc));

    await service.resolve('507f1f77bcf86cd799439012', 'dismissed');

    expect(adminService.unbanUser).not.toHaveBeenCalled();
    expect(doc.status).toBe('dismissed');
  });

  it('resolve: rejects a non-terminal status', async () => {
    await expect(
      service.resolve('507f1f77bcf86cd799439012', 'open' as 'resolved'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(eventModel.findById).not.toHaveBeenCalled();
  });

  it('resolve: 404s an unknown id', async () => {
    eventModel.findById.mockReturnValue(queryReturning(null));

    await expect(service.resolve('507f1f77bcf86cd799439012', 'dismissed')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('resolve: 404s an invalid (non-ObjectId) id without hitting the DB', async () => {
    await expect(service.resolve('nope', 'resolved')).rejects.toBeInstanceOf(NotFoundException);
    expect(eventModel.findById).not.toHaveBeenCalled();
  });

  describe('resolveWithBan', () => {
    it('404s an invalid id without banning', async () => {
      await expect(service.resolveWithBan('nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(eventModel.findById).not.toHaveBeenCalled();
      expect(adminService.banUser).not.toHaveBeenCalled();
    });

    it('404s an unknown item without banning', async () => {
      eventModel.findById.mockReturnValue(queryReturning(null));
      await expect(service.resolveWithBan('507f1f77bcf86cd799439012')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(adminService.banUser).not.toHaveBeenCalled();
    });

    it('bans the flagged user (with a reason) THEN resolves the item', async () => {
      const doc = eventDoc('507f1f77bcf86cd799439012');
      eventModel.findById.mockReturnValue(queryReturning(doc));
      adminService.banUser.mockResolvedValue({ userId: USER, isBanned: true });

      const result = await service.resolveWithBan('507f1f77bcf86cd799439012');

      expect(adminService.banUser).toHaveBeenCalledTimes(1);
      const [bannedId, reason] = adminService.banUser.mock.calls[0] as [string, string];
      expect(bannedId).toBe(USER);
      expect(reason).toContain('nudity');
      expect(doc.status).toBe('resolved');
      expect(doc.save).toHaveBeenCalledTimes(1);
      expect(result.item.status).toBe('resolved');
      expect(result.ban).toEqual({ userId: USER, isBanned: true });
    });

    it('does NOT resolve the item if the ban write fails', async () => {
      const doc = eventDoc('507f1f77bcf86cd799439012');
      eventModel.findById.mockReturnValue(queryReturning(doc));
      adminService.banUser.mockRejectedValue(new Error('ban failed'));

      await expect(service.resolveWithBan('507f1f77bcf86cd799439012')).rejects.toThrow(
        'ban failed',
      );
      expect(doc.save).not.toHaveBeenCalled();
      expect(doc.status).toBe('open');
    });
  });
});
