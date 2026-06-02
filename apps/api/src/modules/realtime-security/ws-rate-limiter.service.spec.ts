import { WsRateLimiterService } from './ws-rate-limiter.service';
import {
  CHAT_MESSAGE_LIMIT,
  MAX_SOCKETS_PER_USER,
  wsRateKey,
  wsSocketCountKey,
} from './realtime-security.constants';

describe('WsRateLimiterService — token buckets + concurrent socket cap', () => {
  const userId = 'u-1';

  let redis: { incr: jest.Mock; expire: jest.Mock; decr: jest.Mock; del: jest.Mock };
  let service: WsRateLimiterService;

  beforeEach(() => {
    redis = {
      incr: jest.fn(),
      expire: jest.fn().mockResolvedValue(1),
      decr: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
    };
    service = new WsRateLimiterService(redis as never);
  });

  describe('consume — fixed-window token bucket', () => {
    it('allows the first hit and arms the window TTL exactly once', async () => {
      redis.incr.mockResolvedValue(1);

      await expect(service.consume(userId, CHAT_MESSAGE_LIMIT)).resolves.toBe(true);

      expect(redis.incr).toHaveBeenCalledWith(wsRateKey(CHAT_MESSAGE_LIMIT.action, userId));
      expect(redis.expire).toHaveBeenCalledWith(
        wsRateKey(CHAT_MESSAGE_LIMIT.action, userId),
        CHAT_MESSAGE_LIMIT.windowSec,
      );
    });

    it('does NOT re-arm the TTL on subsequent in-window hits', async () => {
      redis.incr.mockResolvedValue(5);

      await expect(service.consume(userId, CHAT_MESSAGE_LIMIT)).resolves.toBe(true);

      expect(redis.expire).not.toHaveBeenCalled();
    });

    it('allows exactly `max` hits then rejects the next', async () => {
      redis.incr.mockResolvedValue(CHAT_MESSAGE_LIMIT.max);
      await expect(service.consume(userId, CHAT_MESSAGE_LIMIT)).resolves.toBe(true);

      redis.incr.mockResolvedValue(CHAT_MESSAGE_LIMIT.max + 1);
      await expect(service.consume(userId, CHAT_MESSAGE_LIMIT)).resolves.toBe(false);
    });

    it('keeps rejecting while over the limit without re-arming the TTL', async () => {
      redis.incr.mockResolvedValue(CHAT_MESSAGE_LIMIT.max + 9);

      await expect(service.consume(userId, CHAT_MESSAGE_LIMIT)).resolves.toBe(false);
      expect(redis.expire).not.toHaveBeenCalled();
    });
  });

  describe('registerSocket — concurrent-socket cap', () => {
    it('admits a socket within the cap and arms the counter TTL', async () => {
      redis.incr.mockResolvedValue(1);

      await expect(service.registerSocket(userId)).resolves.toBe(true);

      expect(redis.incr).toHaveBeenCalledWith(wsSocketCountKey(userId));
      expect(redis.expire).toHaveBeenCalledWith(wsSocketCountKey(userId), expect.any(Number));
      expect(redis.decr).not.toHaveBeenCalled();
    });

    it('admits the socket sitting exactly at the cap', async () => {
      redis.incr.mockResolvedValue(MAX_SOCKETS_PER_USER);

      await expect(service.registerSocket(userId)).resolves.toBe(true);
      expect(redis.decr).not.toHaveBeenCalled();
    });

    it('rejects an over-cap socket AND rolls the counter back', async () => {
      redis.incr.mockResolvedValue(MAX_SOCKETS_PER_USER + 1);

      await expect(service.registerSocket(userId)).resolves.toBe(false);
      // The rejected connection must not inflate the live count.
      expect(redis.decr).toHaveBeenCalledWith(wsSocketCountKey(userId));
    });
  });

  describe('releaseSocket — decrement with zero clamp', () => {
    it('decrements the live counter on disconnect', async () => {
      redis.decr.mockResolvedValue(2);

      await service.releaseSocket(userId);

      expect(redis.decr).toHaveBeenCalledWith(wsSocketCountKey(userId));
      // Still positive → key is left in place, not deleted.
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('drops the key entirely once the count reaches zero (never goes negative)', async () => {
      redis.decr.mockResolvedValue(0);

      await service.releaseSocket(userId);

      expect(redis.del).toHaveBeenCalledWith(wsSocketCountKey(userId));
    });

    it('drops the key if a stray decrement underflows below zero', async () => {
      redis.decr.mockResolvedValue(-1);

      await service.releaseSocket(userId);

      expect(redis.del).toHaveBeenCalledWith(wsSocketCountKey(userId));
    });
  });
});
