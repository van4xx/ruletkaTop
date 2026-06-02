import type { Redis } from 'ioredis';
import type { Model } from 'mongoose';

import type { ListNotificationsQuery } from '@ruletka/shared-types';

import type { MetricsService } from '../../observability/metrics.service';
import { NOTIFICATION_NEW_CHANNEL } from './notifications.constants';
import { NotificationsService } from './notifications.service';
import type { PushService } from './push.service';
import type { NotificationDocument } from './schemas/notification.schema';

/** Chainable `find().sort().limit().exec()` stub resolving to `rows`. */
function findReturning(rows: unknown[]): {
  sort: jest.Mock;
  limit: jest.Mock;
  exec: jest.Mock;
} {
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(rows),
  };
}

/** Chainable terminal `.exec()` stub. */
function execReturning(result: unknown): { exec: jest.Mock } {
  return { exec: jest.fn().mockResolvedValue(result) };
}

/**
 * Build a stand-in hydrated notification document. `_id` exposes `toString()`
 * (as a real ObjectId would) and `get('createdAt')` returns a Date.
 */
function notifDoc(over: Partial<Record<string, unknown>> = {}): unknown {
  return {
    _id: { toString: () => 'notif-1' },
    kind: 'gift',
    title: 'You received a gift',
    body: 'Alice sent you a Rose',
    read: false,
    actorId: { toString: () => '507f1f77bcf86cd799439022' },
    link: '/profile/x',
    get: (key: string) =>
      key === 'createdAt' ? new Date('2026-01-01T00:00:00.000Z') : undefined,
    ...over,
  };
}

const RECIPIENT = '507f1f77bcf86cd799439011';
const ACTOR = '507f1f77bcf86cd799439022';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let model: {
    create: jest.Mock;
    find: jest.Mock;
    updateOne: jest.Mock;
    updateMany: jest.Mock;
    countDocuments: jest.Mock;
  };
  let redis: { publish: jest.Mock };
  let push: { fanOut: jest.Mock };
  let metrics: { notificationSent: jest.Mock };

  beforeEach(() => {
    model = {
      create: jest.fn().mockResolvedValue(notifDoc()),
      find: jest.fn().mockReturnValue(findReturning([])),
      updateOne: jest.fn().mockReturnValue(execReturning({ matchedCount: 1 })),
      updateMany: jest.fn().mockReturnValue(execReturning({ modifiedCount: 3 })),
      countDocuments: jest.fn().mockReturnValue(execReturning(0)),
    };
    redis = { publish: jest.fn().mockResolvedValue(1) };
    push = { fanOut: jest.fn().mockResolvedValue(undefined) };
    metrics = { notificationSent: jest.fn() };

    service = new NotificationsService(
      model as unknown as Model<NotificationDocument>,
      redis as unknown as Redis,
      push as unknown as PushService,
      metrics as unknown as MetricsService,
    );
  });

  describe('create', () => {
    it('persists the row, publishes notif:new and fans out a push, returning the contract', async () => {
      const result = await service.create({
        recipientUserId: RECIPIENT,
        kind: 'gift',
        title: 'You received a gift',
        body: 'Alice sent you a Rose',
        actorId: ACTOR,
        link: '/profile/x',
      });

      // Persisted with the recipient + unread.
      expect(model.create).toHaveBeenCalledTimes(1);
      const row = model.create.mock.calls[0][0] as Record<string, unknown>;
      expect(row.read).toBe(false);
      expect(row.kind).toBe('gift');
      expect((row.recipientUserId as { toString: () => string }).toString()).toBe(RECIPIENT);

      // Published on the cross-instance channel for socket delivery…
      expect(redis.publish).toHaveBeenCalledTimes(1);
      const [channel, raw] = redis.publish.mock.calls[0] as [string, string];
      expect(channel).toBe(NOTIFICATION_NEW_CHANNEL);
      const message = JSON.parse(raw) as { userId: string; notification: { id: string; kind: string } };
      expect(message.userId).toBe(RECIPIENT);
      // …carrying the lightweight AppNotification projection (no `read`/`actorId`).
      expect(message.notification).toEqual({
        id: 'notif-1',
        kind: 'gift',
        title: 'You received a gift',
        body: 'Alice sent you a Rose',
        createdAt: '2026-01-01T00:00:00.000Z',
      });

      // …and pushed best-effort to the recipient's registered transports.
      expect(push.fanOut).toHaveBeenCalledTimes(1);
      expect(push.fanOut.mock.calls[0][0]).toBe(RECIPIENT);

      // Returns the full stored contract (with read/actorId/link).
      expect(result).toMatchObject({
        id: 'notif-1',
        kind: 'gift',
        read: false,
        actorId: ACTOR,
        link: '/profile/x',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    });

    it('drops a self-addressed notification (recipient === actor) without persisting', async () => {
      const result = await service.create({
        recipientUserId: RECIPIENT,
        kind: 'gift',
        title: 't',
        body: 'b',
        actorId: RECIPIENT,
      });

      expect(result).toBeNull();
      expect(model.create).not.toHaveBeenCalled();
      expect(redis.publish).not.toHaveBeenCalled();
      expect(push.fanOut).not.toHaveBeenCalled();
    });

    it('returns null and never persists for an invalid recipient id', async () => {
      const result = await service.create({
        recipientUserId: 'not-an-id',
        kind: 'system',
        title: 't',
        body: 'b',
      });

      expect(result).toBeNull();
      expect(model.create).not.toHaveBeenCalled();
    });

    it('still persists + returns even if publish AND push both fail (best-effort delivery)', async () => {
      redis.publish.mockRejectedValue(new Error('redis down'));
      push.fanOut.mockRejectedValue(new Error('push down'));

      const result = await service.create({
        recipientUserId: RECIPIENT,
        kind: 'system',
        title: 'Welcome',
        body: 'Hi',
      });

      expect(model.create).toHaveBeenCalledTimes(1);
      expect(result?.id).toBe('notif-1');
    });
  });

  describe('list', () => {
    const query: ListNotificationsQuery = { limit: 20 };

    it('returns a page newest-first with no cursor when not over the limit', async () => {
      model.find.mockReturnValue(findReturning([notifDoc({ _id: { toString: () => 'n1' } })]));

      const page = await service.list(RECIPIENT, query);

      // Filters by the recipient and sorts by _id desc (newest first).
      const filter = model.find.mock.calls[0][0] as Record<string, unknown>;
      expect((filter.recipientUserId as { toString: () => string }).toString()).toBe(RECIPIENT);
      expect(page.items).toHaveLength(1);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it('sets hasMore + nextCursor when an extra row beyond the limit is returned', async () => {
      const rows = [
        notifDoc({ _id: { toString: () => 'n1' } }),
        notifDoc({ _id: { toString: () => 'n2' } }),
        // The (limit+1)-th row signals there is another page.
        notifDoc({ _id: { toString: () => 'n3' } }),
      ];
      model.find.mockReturnValue(findReturning(rows));

      const page = await service.list(RECIPIENT, { limit: 2 });

      expect(page.items).toHaveLength(2);
      expect(page.hasMore).toBe(true);
      // Cursor is the last RETURNED row's id (not the probe row).
      expect(page.nextCursor).toBe('n2');
    });

    it('narrows to unread when unreadOnly is set', async () => {
      await service.list(RECIPIENT, { limit: 20, unreadOnly: true });

      const filter = model.find.mock.calls[0][0] as Record<string, unknown>;
      expect(filter.read).toBe(false);
    });

    it('returns an empty terminal page for an unparseable cursor', async () => {
      const page = await service.list(RECIPIENT, { limit: 20, cursor: 'not-an-id' });

      expect(page).toEqual({ items: [], nextCursor: null, hasMore: false });
      expect(model.find).not.toHaveBeenCalled();
    });
  });

  describe('markRead', () => {
    it('scopes the update to the id AND the owner (idempotent)', async () => {
      await service.markRead('507f1f77bcf86cd7994390ff', RECIPIENT);

      expect(model.updateOne).toHaveBeenCalledTimes(1);
      const [filter, update] = model.updateOne.mock.calls[0] as [
        Record<string, { toString: () => string }>,
        Record<string, unknown>,
      ];
      expect(filter._id!.toString()).toBe('507f1f77bcf86cd7994390ff');
      expect(filter.recipientUserId!.toString()).toBe(RECIPIENT);
      expect(update).toEqual({ $set: { read: true } });
    });

    it('no-ops on an invalid id', async () => {
      await service.markRead('nope', RECIPIENT);
      expect(model.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('markAllRead', () => {
    it("flips all of the caller's unread rows to read", async () => {
      await service.markAllRead(RECIPIENT);

      expect(model.updateMany).toHaveBeenCalledTimes(1);
      const [filter, update] = model.updateMany.mock.calls[0] as [
        Record<string, unknown>,
        Record<string, unknown>,
      ];
      expect(filter.read).toBe(false);
      expect(update).toEqual({ $set: { read: true } });
    });
  });

  describe('unreadCount', () => {
    it('counts unread rows for the caller', async () => {
      model.countDocuments.mockReturnValue(execReturning(7));

      const count = await service.unreadCount(RECIPIENT);

      expect(count).toBe(7);
      const filter = model.countDocuments.mock.calls[0][0] as Record<string, unknown>;
      expect(filter.read).toBe(false);
    });

    it('returns 0 for an invalid id without querying', async () => {
      const count = await service.unreadCount('bad');
      expect(count).toBe(0);
      expect(model.countDocuments).not.toHaveBeenCalled();
    });
  });
});
