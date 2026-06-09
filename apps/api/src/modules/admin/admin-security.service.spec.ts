import { Types } from 'mongoose';
import type { Connection } from 'mongoose';

import { AdminSecurityService } from './admin-security.service';

/**
 * AdminSecurityService.listEvents unit tests.
 *
 * The service reads every event source by COLLECTION NAME via the shared
 * connection (no cross-module imports), so the test wires a fake `connection`
 * whose `collection(name)` returns a per-collection cursor stub. The focus is
 * the new `auth.login.locked` source (the brute-force lockout feed) added in the
 * observability pass: a lockout audit row must surface in the merged feed.
 */

/** A find-cursor stub supporting `.find().sort().limit().toArray()`. */
function cursorReturning(rows: unknown[]): {
  find: jest.Mock;
  sort: jest.Mock;
  limit: jest.Mock;
  toArray: jest.Mock;
} {
  const cursor = {
    find: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue(rows),
  };
  return cursor;
}

/**
 * Build a fake Mongoose connection whose `collection(name)` returns the cursor
 * for that collection (empty by default). The `sessions` collection is also used
 * by `listSessions` (countDocuments), but `listEvents` only `find`s it.
 */
function buildConnection(byName: Record<string, unknown[]>): Connection {
  const collection = jest.fn((name: string) => cursorReturning(byName[name] ?? []));
  return { collection } as unknown as Connection;
}

describe('AdminSecurityService.listEvents — auth.login.locked source', () => {
  it('surfaces an auth.login.locked audit row in the merged security feed', async () => {
    const lockoutId = new Types.ObjectId();
    const connection = buildConnection({
      admin_audit_logs: [
        {
          _id: lockoutId,
          action: 'auth.login.locked',
          meta: { email: 'victim@example.com', ip: '5.5.5.5', count: 10 },
          createdAt: new Date('2026-06-08T12:00:00.000Z'),
        },
      ],
    });
    const service = new AdminSecurityService(connection);

    const { items } = await service.listEvents();

    // The audit collection is read by name, filtered to the lockout action.
    const collectionMock = (connection.collection as jest.Mock).mock;
    expect(collectionMock.calls.map((c) => c[0])).toContain('admin_audit_logs');

    const lockout = items.find((e) => e.type === 'auth.login.locked');
    expect(lockout).toBeDefined();
    expect(lockout).toMatchObject({
      id: lockoutId.toString(),
      type: 'auth.login.locked',
      // The lockout is keyed by email+IP, never a user account.
      userId: null,
    });
    // The detail carries the email/ip context for the moderator.
    expect(lockout?.detail).toContain('victim@example.com');
    expect(lockout?.detail).toContain('5.5.5.5');
    expect(lockout?.createdAt).toBe('2026-06-08T12:00:00.000Z');
  });

  it('merges + time-sorts the lockout source alongside the other event sources (newest first)', async () => {
    const older = new Types.ObjectId();
    const newer = new Types.ObjectId();
    const connection = buildConnection({
      // A banned user (older) and a login lockout (newer) — the lockout must sort
      // ahead of the ban in the merged, newest-first feed.
      users: [
        {
          _id: older,
          email: 'banned@example.com',
          role: 'user',
          updatedAt: new Date('2026-06-08T10:00:00.000Z'),
        },
      ],
      admin_audit_logs: [
        {
          _id: newer,
          action: 'auth.login.locked',
          meta: { email: 'fresh@example.com', ip: '9.9.9.9', count: 10 },
          createdAt: new Date('2026-06-08T11:00:00.000Z'),
        },
      ],
    });
    const service = new AdminSecurityService(connection);

    const { items } = await service.listEvents();

    expect(items).toHaveLength(2);
    // Newest-first: the lockout (11:00) precedes the ban (10:00).
    expect(items.map((e) => e.type)).toEqual(['auth.login.locked', 'user.banned']);
  });

  it('returns no lockout events when the audit collection has none (other sources still render)', async () => {
    const connection = buildConnection({}); // every source empty
    const service = new AdminSecurityService(connection);

    const { items } = await service.listEvents();

    expect(items.filter((e) => e.type === 'auth.login.locked')).toHaveLength(0);
  });
});
