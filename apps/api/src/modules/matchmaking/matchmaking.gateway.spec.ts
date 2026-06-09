import type { AppIoServer } from '../../realtime/redis-io.adapter';
import {
  activeCallIdKey,
  activeCallPairKey,
  callRoom,
} from './matchmaking.constants';
import { MatchmakingGateway } from './matchmaking.gateway';

/**
 * Records every `server.to(target).emit(event, payload)` and the
 * `server.in(target).socketsJoin/socketsLeave(room)` calls so a test can assert
 * exactly which destinations were reached. `to` and `in` accept a room/socket id
 * (a socket id is itself a room) and return a chainable handle.
 */
interface EmitRecord {
  target: string;
  event: string;
  payload: unknown;
}
interface JoinLeaveRecord {
  target: string;
  room: string;
}

function makeServer(): {
  server: AppIoServer;
  emits: EmitRecord[];
  joins: JoinLeaveRecord[];
  leaves: JoinLeaveRecord[];
} {
  const emits: EmitRecord[] = [];
  const joins: JoinLeaveRecord[] = [];
  const leaves: JoinLeaveRecord[] = [];
  const server = {
    to: (target: string) => ({
      emit: (event: string, payload: unknown) => {
        emits.push({ target, event, payload });
        return true;
      },
    }),
    in: (target: string) => ({
      socketsJoin: (room: string) => {
        joins.push({ target, room });
        return Promise.resolve();
      },
      socketsLeave: (room: string) => {
        leaves.push({ target, room });
        return Promise.resolve();
      },
    }),
  } as unknown as AppIoServer;
  return { server, emits, joins, leaves };
}

/**
 * Minimal in-memory Redis double covering only what the call-index helpers use:
 * `get(key)`, `del(key)`, a chained `multi().set(...).del(...).exec()` pipeline
 * that applies its queued writes to the same backing map on `exec`, and `eval`
 * for the ONE Lua script the gateway runs — the compare-and-delete that clears
 * the active-call pair index only when it still points at the given callId.
 */
function makeRedis(seed: Record<string, string> = {}): {
  redis: { get: jest.Mock; del: jest.Mock; multi: jest.Mock; eval: jest.Mock };
  store: Map<string, string>;
} {
  const store = new Map<string, string>(Object.entries(seed));
  const makePipeline = () => {
    const ops: Array<() => void> = [];
    const pipeline = {
      set: (key: string, value: string) => {
        ops.push(() => store.set(key, value));
        return pipeline;
      },
      del: (key: string) => {
        ops.push(() => store.delete(key));
        return pipeline;
      },
      exec: () => {
        ops.forEach((op) => op());
        return Promise.resolve([]);
      },
    };
    return pipeline;
  };
  const redis = {
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    del: jest.fn((key: string) => {
      const existed = store.delete(key);
      return Promise.resolve(existed ? 1 : 0);
    }),
    multi: jest.fn(() => makePipeline()),
    // Emulates the COMPARE_AND_DEL_LUA: delete KEYS[1] only when it still equals
    // ARGV[1]. The gateway always calls it as eval(script, 1, key, expectedValue).
    eval: jest.fn((_script: string, _numKeys: number, key: string, expected: string) => {
      if (store.get(key) === expected) {
        store.delete(key);
        return Promise.resolve(1);
      }
      return Promise.resolve(0);
    }),
  };
  return { redis, store };
}

/**
 * A socket double: only the surface the handlers under test touch — `id`,
 * `data.userId`, `rooms` membership, and `client.to(room).emit(...)` (excludes
 * the sender).
 */
function makeSocket(
  id: string,
  userId: string | undefined,
  rooms: string[] = [],
): { socket: any; emits: EmitRecord[] } {
  const emits: EmitRecord[] = [];
  const socket = {
    id,
    data: { userId },
    rooms: new Set<string>(rooms),
    to: (target: string) => ({
      emit: (event: string, payload: unknown) => {
        emits.push({ target, event, payload });
        return true;
      },
    }),
  };
  return { socket, emits };
}

/**
 * Build a gateway with all collaborators mocked. Only the methods exercised by
 * the three behaviors under test are stubbed; the rest are present as jest.fn()
 * so construction succeeds. The mocked `server`/`redis` are returned so a test
 * can drive + assert against them.
 */
function makeGateway(opts: {
  redisSeed?: Record<string, string>;
  calls?: Partial<Record<string, jest.Mock>>;
  matchmaking?: Partial<Record<string, jest.Mock>>;
  rateLimiter?: Partial<Record<string, jest.Mock>>;
  liveFlags?: Partial<Record<string, jest.Mock>>;
}) {
  const { server, emits, joins, leaves } = makeServer();
  const { redis, store } = makeRedis(opts.redisSeed);

  const calls = {
    consumePendingForCallee: jest.fn(),
    clearPending: jest.fn().mockResolvedValue(null),
    getPending: jest.fn(),
    ...opts.calls,
  };
  const matchmaking = {
    isBlockedEitherWay: jest.fn().mockResolvedValue(false),
    getRelayTarget: jest.fn().mockResolvedValue(null),
    getUserRoom: jest.fn().mockResolvedValue(null),
    getPeerOf: jest.fn().mockResolvedValue(null),
    teardownRoom: jest.fn().mockResolvedValue(null),
    consumeNextToken: jest.fn().mockResolvedValue(true),
    enqueue: jest.fn().mockResolvedValue(null),
    tryMatch: jest.fn().mockResolvedValue(null),
    ...opts.matchmaking,
  };

  // Token-bucket gate `allowSignal` consults before every rtc:* relay — allow by
  // default so the relay-routing branch under test is reached. The same mock
  // backs the `MM_JOIN_LIMIT` outer guard in `handleJoin`.
  const rateLimiter = { consume: jest.fn().mockResolvedValue(true), ...opts.rateLimiter };

  // Matchmaking kill-switch — enabled by default so `handleJoin` reaches the
  // re-roll path under test.
  const liveFlags = {
    isMatchmakingEnabled: jest.fn().mockResolvedValue(true),
    ...opts.liveFlags,
  };

  const gateway = new MatchmakingGateway(
    matchmaking as never,
    calls as never,
    {} as never, // presence
    {} as never, // settings
    liveFlags as never, // liveFlags
    {} as never, // wsAuth
    rateLimiter as never, // rateLimiter
    {} as never, // metrics
    redis as never,
  );
  // Silence the gateway's internal logger so failing-branch debug lines don't
  // clutter test output.
  (gateway as unknown as { logger: { debug: jest.Mock; error: jest.Mock } }).logger = {
    debug: jest.fn(),
    error: jest.fn(),
  };
  gateway.server = server;

  return {
    gateway,
    server,
    emits,
    joins,
    leaves,
    redis,
    store,
    calls,
    matchmaking,
    rateLimiter,
    liveFlags,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) BLOCK during a friend-call ring: call:accept must ABORT when a block was
//    created mid-ring — emit call:end to both, never join the call room, never
//    index the call.
// ─────────────────────────────────────────────────────────────────────────────
describe('handleCallAccept — block created mid-ring aborts the accept', () => {
  it('emits call:end to BOTH users and does NOT join or index when blocked', async () => {
    const { gateway, emits, joins, store, matchmaking } = makeGateway({
      calls: {
        consumePendingForCallee: jest
          .fn()
          .mockResolvedValue({ callId: 'c1', fromUserId: 'caller', toUserId: 'callee' }),
      },
      matchmaking: {
        // Block appeared between invite and accept.
        isBlockedEitherWay: jest.fn().mockResolvedValue(true),
      },
    });
    const { socket } = makeSocket('sock-callee', 'callee');

    await gateway.handleCallAccept(socket as never, { callId: 'c1' });

    // Both sides told the call ended.
    const endTargets = emits.filter((e) => e.event === 'call:end').map((e) => e.target);
    expect(endTargets).toContain('mm:user:caller');
    expect(endTargets).toContain('mm:user:callee');
    // Never told the caller to start negotiating.
    expect(emits.some((e) => e.event === 'call:accept')).toBe(false);
    // Never joined either side into the call room.
    expect(joins).toHaveLength(0);
    // Never indexed the call.
    expect(store.has(activeCallPairKey('caller', 'callee'))).toBe(false);
    expect(matchmaking.isBlockedEitherWay).toHaveBeenCalledWith('caller', 'callee');
  });

  it('on the happy path joins both rooms, indexes the call and tells the caller', async () => {
    const { gateway, emits, joins, store } = makeGateway({
      calls: {
        consumePendingForCallee: jest
          .fn()
          .mockResolvedValue({ callId: 'c2', fromUserId: 'a', toUserId: 'b' }),
      },
      matchmaking: { isBlockedEitherWay: jest.fn().mockResolvedValue(false) },
    });
    const { socket } = makeSocket('sock-b', 'b');

    await gateway.handleCallAccept(socket as never, { callId: 'c2' });

    // Both users joined the call room.
    expect(joins.map((j) => j.room)).toEqual([callRoom('c2'), callRoom('c2')]);
    // Caller told the call was accepted.
    expect(emits.some((e) => e.event === 'call:accept' && e.target === 'mm:user:a')).toBe(true);
    // Call indexed by pair AND by id so a later block can find + clear it.
    expect(store.get(activeCallPairKey('a', 'b'))).toBe('c2');
    expect(store.get(activeCallIdKey('c2'))).toBe(JSON.stringify({ a: 'a', b: 'b' }));
  });

  it('tears the call down when a block lands JUST AFTER indexing (re-check after index)', async () => {
    // The block re-check runs TWICE: once right after consuming the pending call
    // (returns false → past the pre-index gate) and again after the call is
    // indexed (returns true → the block landed in that window). The accept must
    // abort: never join, never emit call:accept, hang both sides up and clear the
    // index so no accepted call survives the block.
    const isBlockedEitherWay = jest
      .fn()
      .mockResolvedValueOnce(false) // pre-index gate: not yet blocked
      .mockResolvedValueOnce(true); // post-index re-check: block has landed
    const { gateway, emits, joins, store } = makeGateway({
      calls: {
        consumePendingForCallee: jest
          .fn()
          .mockResolvedValue({ callId: 'c3', fromUserId: 'a', toUserId: 'b' }),
      },
      matchmaking: { isBlockedEitherWay },
    });
    const { socket } = makeSocket('sock-b', 'b');

    await gateway.handleCallAccept(socket as never, { callId: 'c3' });

    // Re-checked after indexing.
    expect(isBlockedEitherWay).toHaveBeenCalledTimes(2);
    // Never told the caller to start negotiating, never joined the room.
    expect(emits.some((e) => e.event === 'call:accept')).toBe(false);
    expect(joins).toHaveLength(0);
    // Both sides told the call ended AND hung up with reason 'reported'.
    const endTargets = emits.filter((e) => e.event === 'call:end').map((e) => e.target).sort();
    expect(endTargets).toEqual(['mm:user:a', 'mm:user:b']);
    const hangups = emits.filter((e) => e.event === 'rtc:hangup');
    expect(hangups.map((e) => e.target).sort()).toEqual(['mm:user:a', 'mm:user:b']);
    expect(hangups.every((e) => (e.payload as { reason: string }).reason === 'reported')).toBe(true);
    // The index written before the re-check is cleared by the teardown.
    expect(store.has(activeCallPairKey('a', 'b'))).toBe(false);
    expect(store.has(activeCallIdKey('c3'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1b) clearActiveCallIndex compare-and-delete: a STALE teardown of an OLD call
//     must NOT clobber the pair index of a NEWER live call between the same two
//     users (the pair key was reused). Only the reverse callId→pair key, unique
//     to the stale call, is removed.
// ─────────────────────────────────────────────────────────────────────────────
describe('clearActiveCallIndex — stale teardown must not clobber a newer call', () => {
  it('leaves the pair index intact when it already points at a NEWER call', async () => {
    // The pair key points at the NEW call (cNew). The stale teardown is for the
    // OLD call (cOld), whose reverse id-key still records the same pair.
    const { gateway, store } = makeGateway({
      redisSeed: {
        [activeCallPairKey('a', 'b')]: 'cNew',
        [activeCallIdKey('cOld')]: JSON.stringify({ a: 'a', b: 'b' }),
        [activeCallIdKey('cNew')]: JSON.stringify({ a: 'a', b: 'b' }),
      },
    });

    await (
      gateway as unknown as { clearActiveCallIndex(callId: string): Promise<void> }
    ).clearActiveCallIndex('cOld');

    // The stale call's reverse id-key is removed…
    expect(store.has(activeCallIdKey('cOld'))).toBe(false);
    // …but the pair key STILL points at the newer call (NOT clobbered)…
    expect(store.get(activeCallPairKey('a', 'b'))).toBe('cNew');
    // …and the newer call's own reverse id-key is untouched.
    expect(store.get(activeCallIdKey('cNew'))).toBe(JSON.stringify({ a: 'a', b: 'b' }));
  });

  it('deletes the pair key when it still points at THIS call', async () => {
    const { gateway, store } = makeGateway({
      redisSeed: {
        [activeCallPairKey('a', 'b')]: 'cOld',
        [activeCallIdKey('cOld')]: JSON.stringify({ a: 'a', b: 'b' }),
      },
    });

    await (
      gateway as unknown as { clearActiveCallIndex(callId: string): Promise<void> }
    ).clearActiveCallIndex('cOld');

    // Both keys gone — the pair still pointed at this call, so it is cleared.
    expect(store.has(activeCallPairKey('a', 'b'))).toBe(false);
    expect(store.has(activeCallIdKey('cOld'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2) block:enforce tears down an active friend call between the two users:
//    endCallBetween looks up the indexed call, hangs up both sides and detaches
//    every socket from the call room, clearing the index.
// ─────────────────────────────────────────────────────────────────────────────
describe('endCallBetween — a block ends an in-progress friend call', () => {
  it('ends the indexed call: call:end + rtc:hangup to both, leaves the room, clears the index', async () => {
    const { gateway, emits, leaves, store } = makeGateway({
      // Seed an accepted call between a and b (order-independent pair key).
      redisSeed: {
        [activeCallPairKey('a', 'b')]: 'c9',
        [activeCallIdKey('c9')]: JSON.stringify({ a: 'a', b: 'b' }),
      },
    });

    await (
      gateway as unknown as { endCallBetween(a: string, b: string): Promise<void> }
    ).endCallBetween('b', 'a');

    // Both participants told the call ended and were hung up.
    const ends = emits.filter((e) => e.event === 'call:end');
    expect(ends.map((e) => e.target).sort()).toEqual(['mm:user:a', 'mm:user:b']);
    const hangups = emits.filter((e) => e.event === 'rtc:hangup');
    expect(hangups.map((e) => e.target).sort()).toEqual(['mm:user:a', 'mm:user:b']);
    expect(hangups.every((e) => (e.payload as { reason: string }).reason === 'reported')).toBe(true);
    // Every socket detached from the call room.
    expect(leaves).toContainEqual({ target: callRoom('c9'), room: callRoom('c9') });
    // Index cleared so it can't be force-ended twice.
    expect(store.has(activeCallPairKey('a', 'b'))).toBe(false);
    expect(store.has(activeCallIdKey('c9'))).toBe(false);
  });

  it('is a no-op when no active call is indexed between the pair', async () => {
    const { gateway, emits, leaves } = makeGateway({ redisSeed: {} });

    await (
      gateway as unknown as { endCallBetween(a: string, b: string): Promise<void> }
    ).endCallBetween('x', 'y');

    expect(emits).toHaveLength(0);
    expect(leaves).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3) Multi-device: rtc:* from a socket that is NOT the user's bound device for
//    the room is DROPPED; the bound device's signal is relayed to the peer's
//    bound socket.
// ─────────────────────────────────────────────────────────────────────────────
describe('relaySignal — rejects rtc:* from a non-bound socket', () => {
  it('drops the offer when the sender is not the bound socket for the room', async () => {
    const { gateway, emits, matchmaking } = makeGateway({
      matchmaking: {
        getRelayTarget: jest.fn().mockResolvedValue({
          peerUserId: 'peer',
          peerSocket: 'peer-sock',
          selfSocket: 'bound-sock', // the user's bound device
        }),
      },
    });
    // A SECOND device of the same user (different socket id) tries to inject.
    const { socket } = makeSocket('other-sock', 'user');

    await gateway.handleOffer(socket as never, { roomId: 'room1', sdp: 'x' });

    // Nothing relayed — the non-bound device was rejected.
    expect(emits).toHaveLength(0);
    expect(matchmaking.getRelayTarget).toHaveBeenCalledWith('room1', 'user');
  });

  it('relays to the peer bound socket when the sender IS the bound device', async () => {
    const { gateway, emits } = makeGateway({
      matchmaking: {
        getRelayTarget: jest.fn().mockResolvedValue({
          peerUserId: 'peer',
          peerSocket: 'peer-sock',
          selfSocket: 'bound-sock',
        }),
      },
    });
    const { socket } = makeSocket('bound-sock', 'user');

    await gateway.handleOffer(socket as never, { roomId: 'room1', sdp: 'x' });

    expect(emits).toEqual([
      { target: 'peer-sock', event: 'rtc:offer', payload: { roomId: 'room1', sdp: 'x' } },
    ]);
  });

  it('falls back to the peer user room on a legacy room (selfSocket null)', async () => {
    const { gateway, emits } = makeGateway({
      matchmaking: {
        getRelayTarget: jest.fn().mockResolvedValue({
          peerUserId: 'peer',
          peerSocket: null,
          selfSocket: null, // room predates socket binding
        }),
      },
    });
    const { socket } = makeSocket('any-sock', 'user');

    await gateway.handleOffer(socket as never, { roomId: 'legacy', sdp: 'x' });

    expect(emits).toEqual([
      { target: 'mm:user:peer', event: 'rtc:offer', payload: { roomId: 'legacy', sdp: 'x' } },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4) mm:join while ALREADY IN A ROOM is a re-roll: it must be charged to the
//    stricter `mm:next` skip ceiling (consumeNextToken), NOT bypass it via the
//    laxer MM_JOIN_LIMIT. When over the skip ceiling the user keeps their current
//    room (no teardown) and gets ws:error(event: 'mm:next').
// ─────────────────────────────────────────────────────────────────────────────
describe('handleJoin — in-room re-roll is charged to the mm:next skip throttle', () => {
  const joinPayload = {
    type: 'video' as const,
    filters: {
      gender: 'any' as const,
      ageMin: 18,
      ageMax: 120,
      countries: [] as string[],
      sharedInterestsOnly: false,
    },
  };

  it('consumes a mm:next token and tears down the room when within budget', async () => {
    const consumeNextToken = jest.fn().mockResolvedValue(true);
    const teardownRoom = jest
      .fn()
      .mockResolvedValue({ roomId: 'r1', type: 'video', peerUserId: 'peer', durationMs: null });
    const enqueue = jest.fn().mockResolvedValue(null);
    const { gateway, matchmaking } = makeGateway({
      matchmaking: {
        // User is currently in a room → this join is a re-roll.
        getUserRoom: jest.fn().mockResolvedValue({ roomId: 'r1', type: 'video', filters: {} }),
        consumeNextToken,
        teardownRoom,
        enqueue,
      },
    });
    const { socket } = makeSocket('s1', 'u1');

    await gateway.handleJoin(socket as never, joinPayload);

    // The re-roll was charged to the mm:next bucket…
    expect(consumeNextToken).toHaveBeenCalledWith('u1');
    // …the old room was torn down (voluntary stop)…
    expect(teardownRoom).toHaveBeenCalledWith('u1', 'stop');
    // …and we proceeded to re-queue.
    expect(matchmaking.enqueue).toHaveBeenCalled();
  });

  it('refuses the re-roll WITHOUT teardown and emits ws:error(mm:next) when over the skip ceiling', async () => {
    const consumeNextToken = jest.fn().mockResolvedValue(false); // skip ceiling hit
    const teardownRoom = jest.fn();
    const enqueue = jest.fn();
    const { gateway } = makeGateway({
      matchmaking: {
        getUserRoom: jest.fn().mockResolvedValue({ roomId: 'r1', type: 'video', filters: {} }),
        consumeNextToken,
        teardownRoom,
        enqueue,
      },
    });
    const errors: EmitRecord[] = [];
    const socket: any = {
      id: 's1',
      data: { userId: 'u1' },
      rooms: new Set<string>(),
      emit: (event: string, payload: unknown) => {
        errors.push({ target: 's1', event, payload });
        return true;
      },
    };

    await gateway.handleJoin(socket as never, joinPayload);

    // Charged to mm:next and REJECTED — no teardown, no re-queue.
    expect(consumeNextToken).toHaveBeenCalledWith('u1');
    expect(teardownRoom).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    // Client told it was rate-limited on the mm:next ceiling.
    expect(errors).toContainEqual({
      target: 's1',
      event: 'ws:error',
      payload: { code: 'rate_limited', event: 'mm:next' },
    });
  });

  it('does NOT consume a mm:next token on a first join (no active room)', async () => {
    const consumeNextToken = jest.fn();
    const { gateway, matchmaking } = makeGateway({
      matchmaking: {
        // No active room → first join, governed only by the MM_JOIN_LIMIT guard.
        getUserRoom: jest.fn().mockResolvedValue(null),
        consumeNextToken,
        enqueue: jest.fn().mockResolvedValue(null),
      },
    });
    const { socket } = makeSocket('s1', 'u1');

    await gateway.handleJoin(socket as never, joinPayload);

    // The stricter skip throttle is NOT charged on a genuine first join.
    expect(consumeNextToken).not.toHaveBeenCalled();
    expect(matchmaking.enqueue).toHaveBeenCalled();
  });
});
