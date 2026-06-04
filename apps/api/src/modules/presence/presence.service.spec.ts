import type { ConfigService } from '@nestjs/config';

import { PresenceService } from './presence.service';
import {
  DEFAULT_PRESENCE_TTL_SECONDS,
  PRESENCE_CHANNEL,
  presenceConnKey,
  presenceStatusKey,
} from './presence.constants';

/**
 * Presence transitions hinge on the GLOBAL per-user connection counter: a user
 * with sockets on multiple replicas must be online exactly once, so `online` is
 * announced only on the 0→1 edge and `offline` only on the →0 edge. The counter
 * INCR/DECR run in Lua (atomic, returning the resulting count); these tests mock
 * `eval` to return that count and assert the resulting status writes + publishes.
 */
describe('PresenceService — global connection refcount transitions', () => {
  const userId = 'u-1';

  let redis: {
    eval: jest.Mock;
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    mget: jest.Mock;
    publish: jest.Mock;
  };
  let service: PresenceService;

  function makeConfig(): ConfigService {
    return {
      get: (_key: string, fallback?: unknown) => fallback,
    } as unknown as ConfigService;
  }

  beforeEach(() => {
    redis = {
      eval: jest.fn(),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(0),
      mget: jest.fn().mockResolvedValue([]),
      publish: jest.fn().mockResolvedValue(1),
    };
    service = new PresenceService(redis as never, makeConfig());
  });

  describe('connect — 0→1 edge brings the user online', () => {
    it('publishes `online` and writes the status key when this is the FIRST connection', async () => {
      redis.eval.mockResolvedValue(1); // INCR returned 1 → 0→1 edge
      redis.get.mockResolvedValue(null); // no prior status

      await service.connect(userId);

      // The counter was bumped + TTL armed (the conn-INCR Lua, keyed by conn key).
      expect(redis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        presenceConnKey(userId),
        expect.any(String),
      );
      // Status flipped online with the heartbeat TTL.
      expect(redis.set).toHaveBeenCalledWith(
        presenceStatusKey(userId),
        'online',
        'EX',
        DEFAULT_PRESENCE_TTL_SECONDS,
      );
      // Transition published for cross-replica relay.
      expect(redis.publish).toHaveBeenCalledWith(
        PRESENCE_CHANNEL,
        JSON.stringify({ userId, status: 'online' }),
      );
    });

    it('does NOT re-announce online on a SUBSEQUENT connection (count > 1)', async () => {
      redis.eval.mockResolvedValue(2); // second socket, already online

      await service.connect(userId);

      // No status write, no publish — only the counter was bumped.
      expect(redis.set).not.toHaveBeenCalled();
      expect(redis.publish).not.toHaveBeenCalled();
    });
  });

  describe('disconnect — →0 edge takes the user offline', () => {
    it('publishes `offline` and deletes the status key on the LAST disconnect', async () => {
      redis.eval.mockResolvedValue(0); // DECR clamped to 0 → →0 edge
      redis.del.mockResolvedValue(1); // status key existed → setStatus publishes

      await service.disconnect(userId);

      expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, presenceConnKey(userId));
      // setStatus('offline') deletes the status key…
      expect(redis.del).toHaveBeenCalledWith(presenceStatusKey(userId));
      // …and publishes the offline transition (the key existed).
      expect(redis.publish).toHaveBeenCalledWith(
        PRESENCE_CHANNEL,
        JSON.stringify({ userId, status: 'offline' }),
      );
    });

    it('stays ONLINE when another socket remains (count still > 0)', async () => {
      redis.eval.mockResolvedValue(1); // one socket left after this disconnect

      await service.disconnect(userId);

      // No offline write/publish — the user is still reachable elsewhere.
      expect(redis.del).not.toHaveBeenCalled();
      expect(redis.publish).not.toHaveBeenCalled();
    });
  });

  describe('refreshConnection — heartbeat re-arms TTL without resurrecting', () => {
    it('touches the conn counter TTL and refreshes the status heartbeat', async () => {
      redis.eval.mockResolvedValue(1); // CONN_TOUCH_LUA return
      redis.get.mockResolvedValue('online'); // existing status → heartbeat keeps it

      await service.refreshConnection(userId);

      // The touch Lua ran against the conn key with a TTL arg.
      expect(redis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        presenceConnKey(userId),
        expect.any(String),
      );
      // heartbeat() re-armed the status key without changing the value.
      expect(redis.set).toHaveBeenCalledWith(
        presenceStatusKey(userId),
        'online',
        'EX',
        DEFAULT_PRESENCE_TTL_SECONDS,
      );
      // Unchanged status → no spurious publish.
      expect(redis.publish).not.toHaveBeenCalled();
    });
  });
});
