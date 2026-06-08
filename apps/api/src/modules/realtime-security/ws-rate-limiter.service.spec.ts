import { WsRateLimiterService } from './ws-rate-limiter.service';
import {
  CHAT_MESSAGE_LIMIT,
  MAX_SOCKETS_PER_USER,
  WS_HANDSHAKE_IP_LIMIT,
  wsHandshakeIpKey,
  wsRateKey,
  wsSocketCountKey,
} from './realtime-security.constants';

describe('WsRateLimiterService — token buckets + concurrent socket cap', () => {
  const userId = 'u-1';

  let redis: {
    incr: jest.Mock;
    expire: jest.Mock;
    decr: jest.Mock;
    del: jest.Mock;
    eval: jest.Mock;
  };
  let service: WsRateLimiterService;

  beforeEach(() => {
    redis = {
      incr: jest.fn(),
      expire: jest.fn().mockResolvedValue(1),
      decr: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
      eval: jest.fn(),
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

  describe('consumeHandshakeIp — per-IP pre-auth handshake throttle', () => {
    const ip = '203.0.113.7';

    it('admits the first handshake in a window (atomic INCR+EXPIRE via Lua)', async () => {
      redis.eval.mockResolvedValue(1);

      await expect(service.consumeHandshakeIp(ip, WS_HANDSHAKE_IP_LIMIT)).resolves.toBe(true);

      // One atomic round-trip keyed on the per-IP handshake key with the window.
      expect(redis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        wsHandshakeIpKey(ip),
        String(WS_HANDSHAKE_IP_LIMIT.windowSec),
      );
    });

    it('admits exactly `max` handshakes then rejects the next', async () => {
      redis.eval.mockResolvedValue(WS_HANDSHAKE_IP_LIMIT.max);
      await expect(service.consumeHandshakeIp(ip, WS_HANDSHAKE_IP_LIMIT)).resolves.toBe(true);

      redis.eval.mockResolvedValue(WS_HANDSHAKE_IP_LIMIT.max + 1);
      await expect(service.consumeHandshakeIp(ip, WS_HANDSHAKE_IP_LIMIT)).resolves.toBe(false);
    });

    it('fails OPEN (no Redis call) when the IP is missing/blank', async () => {
      await expect(service.consumeHandshakeIp(undefined, WS_HANDSHAKE_IP_LIMIT)).resolves.toBe(true);
      await expect(service.consumeHandshakeIp('', WS_HANDSHAKE_IP_LIMIT)).resolves.toBe(true);
      expect(redis.eval).not.toHaveBeenCalled();
    });
  });

  describe('registerSocket — concurrent-socket cap (atomic Lua)', () => {
    it('admits a socket within the cap (script returns the live count)', async () => {
      redis.eval.mockResolvedValue(1);

      await expect(service.registerSocket(userId)).resolves.toBe(true);

      // One atomic round-trip: INCR + EXPIRE + over-cap rollback in the script.
      expect(redis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        wsSocketCountKey(userId),
        expect.any(String),
        String(MAX_SOCKETS_PER_USER),
      );
    });

    it('admits the socket sitting exactly at the cap', async () => {
      redis.eval.mockResolvedValue(MAX_SOCKETS_PER_USER);

      await expect(service.registerSocket(userId)).resolves.toBe(true);
    });

    it('rejects an over-cap socket (script rolled back → returns 0)', async () => {
      // The Lua script DECRs the over-cap connection itself and returns 0.
      redis.eval.mockResolvedValue(0);

      await expect(service.registerSocket(userId)).resolves.toBe(false);
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
