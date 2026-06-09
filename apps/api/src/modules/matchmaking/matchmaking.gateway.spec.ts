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
 * `get(key)` and a chained `multi().set(...).del(...).exec()` pipeline that
 * applies its queued writes to the same backing map on `exec`.
 */
function makeRedis(seed: Record<string, string> = {}): {
  redis: { get: jest.Mock; multi: jest.Mock };
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
    multi: jest.fn(() => makePipeline()),
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
    ...opts.matchmaking,
  };

  // Token-bucket gate `allowSignal` consults before every rtc:* relay — allow by
  // default so the relay-routing branch under test is reached.
  const rateLimiter = { consume: jest.fn().mockResolvedValue(true) };

  const gateway = new MatchmakingGateway(
    matchmaking as never,
    calls as never,
    {} as never, // presence
    {} as never, // settings
    {} as never, // liveFlags
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

  return { gateway, server, emits, joins, leaves, redis, store, calls, matchmaking };
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
