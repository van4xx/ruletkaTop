import { CallService } from './call.service';
import { CALL_RING_TTL_SECONDS, callKey } from './matchmaking.constants';
import type { PendingCall } from './matchmaking.types';

/**
 * The call registry owns the ringing-call lifecycle: a pending call is stored
 * under {@link callKey} with the ring TTL and may be answered EXACTLY ONCE, only
 * by the user it was placed to. These tests mock Redis to assert the TTL is set
 * on invite and that the atomic consume is both single-use and callee-scoped.
 */
describe('CallService — pending friend-call lifecycle', () => {
  const fromUserId = 'caller-1';
  const toUserId = 'callee-2';

  let redis: { set: jest.Mock; get: jest.Mock; eval: jest.Mock };
  let service: CallService;

  beforeEach(() => {
    redis = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
      eval: jest.fn().mockResolvedValue(null),
    };
    service = new CallService(redis as never);
  });

  describe('createPending — mints a call and arms the ring timeout', () => {
    it('stores the pending call with a uuid callId and the ring TTL', async () => {
      const call = await service.createPending(fromUserId, toUserId, 'video');

      expect(call.fromUserId).toBe(fromUserId);
      expect(call.toUserId).toBe(toUserId);
      expect(call.type).toBe('video');
      expect(call.callId).toMatch(/[0-9a-f-]{36}/);

      // Persisted under the call key with the ring TTL (the ring timeout).
      expect(redis.set).toHaveBeenCalledWith(
        callKey(call.callId),
        expect.any(String),
        'EX',
        CALL_RING_TTL_SECONDS,
      );
      // The stored JSON round-trips to the returned call.
      const [, storedJson] = redis.set.mock.calls[0] as [string, string, string, number];
      expect(JSON.parse(storedJson)).toMatchObject({
        callId: call.callId,
        fromUserId,
        toUserId,
        type: 'video',
      });
    });

    it('mints a DISTINCT callId per invite', async () => {
      const a = await service.createPending(fromUserId, toUserId, 'voice');
      const b = await service.createPending(fromUserId, toUserId, 'voice');
      expect(a.callId).not.toBe(b.callId);
    });
  });

  describe('consumePendingForCallee — single-use, callee-scoped', () => {
    const pending: PendingCall = {
      callId: 'call-abc',
      fromUserId,
      toUserId,
      type: 'video',
      createdAt: 1_700_000_000_000,
    };

    it('returns + clears the call for the intended callee (Lua matched & deleted)', async () => {
      // The Lua returns the stored JSON when toUserId matches and deletes the key.
      redis.eval.mockResolvedValue(JSON.stringify(pending));

      const result = await service.consumePendingForCallee(pending.callId, toUserId);

      expect(result).toEqual(pending);
      expect(redis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        callKey(pending.callId),
        toUserId,
      );
    });

    it('returns null when the call is gone / already answered (Lua returned null)', async () => {
      redis.eval.mockResolvedValue(null);

      await expect(service.consumePendingForCallee(pending.callId, toUserId)).resolves.toBeNull();
    });

    it('passes the callee id to the Lua so an unrelated user cannot consume it', async () => {
      // A non-callee → the Lua's toUserId guard returns false (null here).
      redis.eval.mockResolvedValue(null);

      const result = await service.consumePendingForCallee(pending.callId, 'someone-else');

      expect(result).toBeNull();
      expect(redis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        callKey(pending.callId),
        'someone-else',
      );
    });
  });

  describe('clearPending — cancel a still-ringing call', () => {
    it('returns the cleared call (GETDEL Lua) so the other party can be notified', async () => {
      const pending: PendingCall = {
        callId: 'call-xyz',
        fromUserId,
        toUserId,
        type: 'voice',
        createdAt: 1_700_000_000_000,
      };
      redis.eval.mockResolvedValue(JSON.stringify(pending));

      await expect(service.clearPending(pending.callId)).resolves.toEqual(pending);
      expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, callKey(pending.callId));
    });

    it('returns null when there was nothing to clear', async () => {
      redis.eval.mockResolvedValue(null);
      await expect(service.clearPending('nope')).resolves.toBeNull();
    });
  });

  describe('getPending — read without consuming', () => {
    it('parses the stored call', async () => {
      const pending: PendingCall = {
        callId: 'call-read',
        fromUserId,
        toUserId,
        type: 'video',
        createdAt: 1_700_000_000_000,
      };
      redis.get.mockResolvedValue(JSON.stringify(pending));

      await expect(service.getPending(pending.callId)).resolves.toEqual(pending);
      expect(redis.get).toHaveBeenCalledWith(callKey(pending.callId));
    });

    it('returns null for an unknown / expired call', async () => {
      redis.get.mockResolvedValue(null);
      await expect(service.getPending('gone')).resolves.toBeNull();
    });
  });
});
