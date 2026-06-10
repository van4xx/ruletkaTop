import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import type { MatchFilters, MatchType } from '@ruletka/shared-types';

import { REDIS_CLIENT } from '../../redis/redis.constants';
import {
  BLOCKS_SERVICE,
  FRIENDS_SERVICE,
  PREMIUM_SERVICE,
  PROFILES_SERVICE,
} from './contracts/external-services';
import { MatchService } from './match.service';
import {
  NEXT_MAX_PER_WINDOW,
  NEXT_WINDOW_SECONDS,
  nextRateKey,
  poolKey,
  waiterKey,
} from './matchmaking.constants';
import {
  areMutuallyCompatible,
  coerceToFreeFilters,
  MatchmakingService,
  sharedInterestCount,
} from './matchmaking.service';
import type { WaiterEntry } from './matchmaking.types';

/**
 * Default open filters: accept any gender, the full adult age range, no country
 * restriction. Individual tests override only the field they exercise so each
 * case isolates ONE compatibility dimension.
 */
function filters(overrides: Partial<MatchFilters> = {}): MatchFilters {
  return {
    gender: 'any',
    ageMin: 18,
    ageMax: 120,
    countries: [],
    sharedInterestsOnly: false,
    ...overrides,
  };
}

/** Build a {@link WaiterEntry} with sensible defaults; override per test. */
function waiter(overrides: Partial<WaiterEntry> = {}): WaiterEntry {
  return {
    userId: 'u-default',
    type: 'video',
    filters: filters(),
    age: 30,
    gender: 'male',
    country: 'RU',
    interests: [],
    isPremium: false,
    socketId: 'sock-default',
    joinedAt: 1_700_000_000_000,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure compatibility predicate — the heart of "who can match whom". Tested
// directly because it is exported and side-effect free (no Redis needed). This
// is the mutual, symmetric filter check `tryMatch` gates every pairing on.
// ─────────────────────────────────────────────────────────────────────────────
describe('areMutuallyCompatible — mutual filter satisfaction', () => {
  it('matches a pair when BOTH sides accept the other (open filters)', () => {
    const a = waiter({ userId: 'a', gender: 'male', age: 25, country: 'RU' });
    const b = waiter({ userId: 'b', gender: 'female', age: 30, country: 'US' });
    expect(areMutuallyCompatible(a, b)).toBe(true);
    // Symmetric by construction.
    expect(areMutuallyCompatible(b, a)).toBe(true);
  });

  it('does NOT match when one side wants a gender the other is not', () => {
    // A wants female; B is male → A's filter rejects B even though B accepts A.
    const a = waiter({ userId: 'a', gender: 'female', filters: filters({ gender: 'female' }) });
    const b = waiter({ userId: 'b', gender: 'male', filters: filters({ gender: 'any' }) });
    expect(areMutuallyCompatible(a, b)).toBe(false);
    expect(areMutuallyCompatible(b, a)).toBe(false);
  });

  it('requires the gender preference to hold in BOTH directions', () => {
    // Each wants the other's exact gender → mutually OK.
    const a = waiter({ userId: 'a', gender: 'male', filters: filters({ gender: 'female' }) });
    const b = waiter({ userId: 'b', gender: 'female', filters: filters({ gender: 'male' }) });
    expect(areMutuallyCompatible(a, b)).toBe(true);

    // Now B wants female but A is male → B's side fails, so the pair fails.
    const a2 = waiter({ userId: 'a', gender: 'male', filters: filters({ gender: 'female' }) });
    const b2 = waiter({ userId: 'b', gender: 'female', filters: filters({ gender: 'female' }) });
    expect(areMutuallyCompatible(a2, b2)).toBe(false);
  });

  it("does NOT match when one party falls outside the other's age range", () => {
    // A only wants 18..29; B is 40 → out of A's window.
    const a = waiter({ userId: 'a', age: 25, filters: filters({ ageMin: 18, ageMax: 29 }) });
    const b = waiter({ userId: 'b', age: 40, filters: filters({ ageMin: 18, ageMax: 120 }) });
    expect(areMutuallyCompatible(a, b)).toBe(false);
  });

  it('treats the age window as inclusive on both bounds', () => {
    // B sits exactly on A's ageMax and A sits exactly on B's ageMin.
    const a = waiter({ userId: 'a', age: 30, filters: filters({ ageMin: 18, ageMax: 40 }) });
    const b = waiter({ userId: 'b', age: 40, filters: filters({ ageMin: 30, ageMax: 50 }) });
    expect(areMutuallyCompatible(a, b)).toBe(true);

    // One year past the boundary breaks it.
    const b2 = waiter({ userId: 'b', age: 41, filters: filters({ ageMin: 30, ageMax: 50 }) });
    expect(areMutuallyCompatible(a, b2)).toBe(false);
  });

  it('requires age ranges to overlap from BOTH perspectives', () => {
    // A is 50 wanting 45..55; B is 48 wanting 18..40. B accepts nobody over 40,
    // so although A would accept B, B rejects A.
    const a = waiter({ userId: 'a', age: 50, filters: filters({ ageMin: 45, ageMax: 55 }) });
    const b = waiter({ userId: 'b', age: 48, filters: filters({ ageMin: 18, ageMax: 40 }) });
    expect(areMutuallyCompatible(a, b)).toBe(false);
  });

  it('excludes a peer whose country is not in a non-empty country filter', () => {
    // A only wants peers from RU/BY; B is in the US → excluded.
    const a = waiter({ userId: 'a', country: 'RU', filters: filters({ countries: ['RU', 'BY'] }) });
    const b = waiter({ userId: 'b', country: 'US', filters: filters({ countries: [] }) });
    expect(areMutuallyCompatible(a, b)).toBe(false);
  });

  it("matches when each non-empty country filter contains the other's country", () => {
    const a = waiter({ userId: 'a', country: 'RU', filters: filters({ countries: ['US', 'CA'] }) });
    const b = waiter({ userId: 'b', country: 'US', filters: filters({ countries: ['RU'] }) });
    expect(areMutuallyCompatible(a, b)).toBe(true);
  });

  it('requires the country filter to be satisfied in BOTH directions', () => {
    // A accepts US (B is US) but B only accepts CA while A is RU → B's side fails.
    const a = waiter({ userId: 'a', country: 'RU', filters: filters({ countries: ['US'] }) });
    const b = waiter({ userId: 'b', country: 'US', filters: filters({ countries: ['CA'] }) });
    expect(areMutuallyCompatible(a, b)).toBe(false);
  });

  it('ignores country entirely when both filters are empty', () => {
    const a = waiter({ userId: 'a', country: 'RU', filters: filters({ countries: [] }) });
    const b = waiter({ userId: 'b', country: 'JP', filters: filters({ countries: [] }) });
    expect(areMutuallyCompatible(a, b)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sharedInterestCount — pure overlap counter that both gates the
// `sharedInterestsOnly` filter and drives interest-aware ranking. Tags are
// stored normalised (lowercased, deduped), so this is a plain set intersection.
// ─────────────────────────────────────────────────────────────────────────────
describe('sharedInterestCount — interest overlap', () => {
  it('counts the tags two sets have in common', () => {
    expect(sharedInterestCount(['music', 'gaming', 'travel'], ['gaming', 'travel', 'art'])).toBe(2);
  });

  it('is 0 when there is no overlap', () => {
    expect(sharedInterestCount(['music'], ['sports'])).toBe(0);
  });

  it('is 0 when either side has no interests (no-interest users never block on overlap)', () => {
    expect(sharedInterestCount([], ['music'])).toBe(0);
    expect(sharedInterestCount(['music'], [])).toBe(0);
    expect(sharedInterestCount(undefined, undefined)).toBe(0);
  });

  it('is symmetric', () => {
    const a = ['music', 'gaming'];
    const b = ['gaming', 'art', 'music'];
    expect(sharedInterestCount(a, b)).toBe(sharedInterestCount(b, a));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// coerceToFreeFilters — strips the PREMIUM-only dimensions (gender / country /
// sharedInterestsOnly) to their open defaults while preserving the always-free
// age window. Pure + exported, so tested directly.
// ─────────────────────────────────────────────────────────────────────────────
describe('coerceToFreeFilters — premium-filter stripping', () => {
  it('resets gender, countries and sharedInterestsOnly to open defaults', () => {
    const coerced = coerceToFreeFilters(
      filters({ gender: 'female', countries: ['RU'], sharedInterestsOnly: true }),
    );
    expect(coerced.gender).toBe('any');
    expect(coerced.countries).toEqual([]);
    expect(coerced.sharedInterestsOnly).toBe(false);
  });

  it('preserves the always-free age window', () => {
    const coerced = coerceToFreeFilters(filters({ ageMin: 25, ageMax: 40 }));
    expect(coerced.ageMin).toBe(25);
    expect(coerced.ageMax).toBe(40);
  });

  it('is a no-op for filters that are already open', () => {
    const open = filters();
    expect(coerceToFreeFilters(open)).toEqual(open);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tryMatch — pool scan with self-exclusion, mutual compatibility, block gating
// and premium-priority ordering. Redis + the cross-module services are mocked.
// ─────────────────────────────────────────────────────────────────────────────
describe('MatchmakingService.tryMatch — pairing, blocks, self, premium priority', () => {
  let service: MatchmakingService;
  let redis: {
    zrange: jest.Mock;
    zrem: jest.Mock;
    zscore: jest.Mock;
    get: jest.Mock;
    mget: jest.Mock;
    set: jest.Mock;
    incr: jest.Mock;
    expire: jest.Mock;
    eval: jest.Mock;
    multi: jest.Mock;
  };
  let matchService: { createMatch: jest.Mock; endMatch: jest.Mock };
  let profiles: { getPublicProfile: jest.Mock; getAgeAndGender: jest.Mock };
  let blocks: { isBlocked: jest.Mock };
  let premium: { isPremium: jest.Mock };
  let friends: { areFriends: jest.Mock };
  // Stubs the `settings` collection read for whoCanCall. Default: 'everyone' so
  // the privacy gate is a no-op unless a test overrides it.
  let settingsFindOne: jest.Mock;
  let connection: { collection: jest.Mock };
  // Models the Redis hash store keyed by waiterKey(userId) → WaiterEntry.
  let waiterStore: Map<string, WaiterEntry>;
  // Pool membership: candidate ids returned by zrange in priority order.
  let poolOrder: string[];
  // Batched liveness oracle the gateway passes in; default: everyone the matcher
  // asks about is live (returns the full requested id set).
  const alwaysConnected = jest
    .fn<Promise<Set<string>>, [readonly string[]]>()
    .mockImplementation((ids: readonly string[]) => Promise.resolve(new Set(ids)));

  beforeEach(async () => {
    waiterStore = new Map();
    poolOrder = [];

    const pipeline = {
      set: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(),
      zadd: jest.fn().mockReturnThis(),
      zrem: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };

    redis = {
      // zrange(pool, 0, n) → the configured priority-ordered candidate ids.
      zrange: jest.fn().mockImplementation(() => Promise.resolve([...poolOrder])),
      zrem: jest.fn().mockResolvedValue(1),
      // zscore: a member exists iff still in poolOrder (claim-race check).
      zscore: jest
        .fn()
        .mockImplementation((_key: string, member: string) =>
          Promise.resolve(poolOrder.includes(member) ? 0 : null),
        ),
      get: jest.fn().mockImplementation((key: string) => {
        for (const [uid, entry] of waiterStore) {
          if (key === waiterKey(uid)) {
            return Promise.resolve(JSON.stringify(entry));
          }
        }
        return Promise.resolve(null);
      }),
      // Batched waiter-hash load (one MGET per match pass). Resolves each key
      // against the same store as `get`, preserving input order with null gaps
      // for missing (stale) waiters.
      mget: jest.fn().mockImplementation((keys: string[]) =>
        Promise.resolve(
          keys.map((key) => {
            for (const [uid, entry] of waiterStore) {
              if (key === waiterKey(uid)) {
                return JSON.stringify(entry);
              }
            }
            return null;
          }),
        ),
      ),
      set: jest.fn().mockResolvedValue('OK'),
      incr: jest.fn(),
      expire: jest.fn().mockResolvedValue(1),
      // CLAIM_PAIR_LUA succeeds (returns 1) by default — both still present.
      eval: jest.fn().mockResolvedValue(1),
      multi: jest.fn().mockReturnValue(pipeline),
    };

    matchService = {
      createMatch: jest.fn().mockResolvedValue('507f1f77bcf86cd799439099'),
      endMatch: jest.fn().mockResolvedValue(1000),
    };
    profiles = {
      // commitMatch builds peer overlays via getPublicProfile; return a minimal one.
      getPublicProfile: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          id,
          nickname: `nick-${id}`,
          age: 30,
          gender: 'male',
          country: 'RU',
          avatarUrl: null,
          badges: [],
          isPremium: false,
        }),
      ),
      getAgeAndGender: jest.fn(),
    };
    blocks = { isBlocked: jest.fn().mockResolvedValue(false) };
    premium = { isPremium: jest.fn().mockResolvedValue(false) };
    // Default: everyone is friends so the privacy gate is a no-op for the
    // pairing/block/premium tests (which use short, non-ObjectId ids — those
    // fall back to the secure 'friends' default in getWhoCanCall). Privacy
    // tests below override areFriends / the settings read explicitly.
    friends = { areFriends: jest.fn().mockResolvedValue(true) };
    // Default whoCanCall: 'everyone' (privacy gate is a no-op) unless overridden.
    settingsFindOne = jest.fn().mockResolvedValue({ privacy: { whoCanCall: 'everyone' } });
    connection = { collection: jest.fn().mockReturnValue({ findOne: settingsFindOne }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MatchmakingService,
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: MatchService, useValue: matchService },
        { provide: PROFILES_SERVICE, useValue: profiles },
        { provide: BLOCKS_SERVICE, useValue: blocks },
        { provide: PREMIUM_SERVICE, useValue: premium },
        { provide: FRIENDS_SERVICE, useValue: friends },
        { provide: getConnectionToken(), useValue: connection },
      ],
    }).compile();

    service = moduleRef.get(MatchmakingService);
    alwaysConnected.mockClear();
  });

  /** Register a waiter in both the hash store and the pool ordering. */
  function seat(entry: WaiterEntry): WaiterEntry {
    waiterStore.set(entry.userId, entry);
    poolOrder.push(entry.userId);
    return entry;
  }

  it('pairs a joiner with the sole compatible waiter and persists the match', async () => {
    const peer = seat(waiter({ userId: 'peer', socketId: 'sock-peer' }));
    const joiner = waiter({ userId: 'joiner', socketId: 'sock-joiner' });
    // Joiner is enqueued too (so an opposite-direction matcher could find them).
    seat(joiner);

    const result = await service.tryMatch(joiner, alwaysConnected);

    expect(result).not.toBeNull();
    expect(result?.peer.userId).toBe('peer');
    // userA = the waiter, userB = the joiner per the MatchService contract.
    expect(matchService.createMatch).toHaveBeenCalledWith(
      'peer',
      'joiner',
      'video',
      joiner.filters,
    );
    // The pair was atomically claimed via the Lua script (both still present).
    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(peer.userId).toBe('peer'); // sanity: seat returns the entry
  });

  it('never matches a user with themselves (skips own id in the pool)', async () => {
    const joiner = waiter({ userId: 'solo', socketId: 'sock-solo' });
    seat(joiner); // only member of the pool is the joiner

    const result = await service.tryMatch(joiner, alwaysConnected);

    expect(result).toBeNull();
    expect(matchService.createMatch).not.toHaveBeenCalled();
    // The claim script must never run when the only candidate is self.
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('skips an incompatible candidate (gender mismatch) and matches nobody', async () => {
    // Waiter wants only females; joiner is male and wants only females too.
    seat(
      waiter({
        userId: 'peer',
        gender: 'male',
        filters: filters({ gender: 'female' }),
      }),
    );
    const joiner = waiter({
      userId: 'joiner',
      gender: 'male',
      filters: filters({ gender: 'female' }),
    });
    seat(joiner);

    const result = await service.tryMatch(joiner, alwaysConnected);

    expect(result).toBeNull();
    expect(matchService.createMatch).not.toHaveBeenCalled();
  });

  it('does NOT pair a blocked pair even when filters are mutually compatible', async () => {
    seat(waiter({ userId: 'peer' }));
    const joiner = waiter({ userId: 'joiner' });
    seat(joiner);
    // Block is detected from the joiner→peer direction.
    blocks.isBlocked.mockResolvedValue(true);

    const result = await service.tryMatch(joiner, alwaysConnected);

    expect(result).toBeNull();
    expect(blocks.isBlocked).toHaveBeenCalledWith('joiner', 'peer');
    expect(matchService.createMatch).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
  });

  // ── whoCanCall privacy gate ──────────────────────────────────────────────
  // These use VALID 24-hex ObjectId ids so the real `settings` read path runs
  // (getWhoCanCall short-circuits invalid ids to the secure 'friends' default).
  const PEER_OID = '507f1f77bcf86cd799439001';
  const JOINER_OID = '507f1f77bcf86cd799439002';
  const PEER_B_OID = '507f1f77bcf86cd799439003';

  /** whoCanCall stub mapping each user id → its configured visibility. */
  function whoCanCallBy(map: Record<string, string>, fallback = 'everyone'): void {
    settingsFindOne.mockImplementation((filter: { userId: { toString(): string } }) => {
      const uid = filter.userId.toString();
      return Promise.resolve({ privacy: { whoCanCall: map[uid] ?? fallback } });
    });
  }

  it("matches when both parties' whoCanCall is 'everyone' (no friendship needed)", async () => {
    seat(waiter({ userId: PEER_OID }));
    const joiner = waiter({ userId: JOINER_OID });
    seat(joiner);
    whoCanCallBy({ [PEER_OID]: 'everyone', [JOINER_OID]: 'everyone' });

    const result = await service.tryMatch(joiner, alwaysConnected);

    expect(result?.peer.userId).toBe(PEER_OID);
    // 'everyone' on both sides never needs a friendship lookup.
    expect(friends.areFriends).not.toHaveBeenCalled();
  });

  it("does NOT match when a candidate's whoCanCall is 'nobody'", async () => {
    seat(waiter({ userId: PEER_OID }));
    const joiner = waiter({ userId: JOINER_OID });
    seat(joiner);
    // Peer accepts calls from nobody; joiner is 'everyone'. Mutual gate fails.
    whoCanCallBy({ [PEER_OID]: 'nobody', [JOINER_OID]: 'everyone' });

    const result = await service.tryMatch(joiner, alwaysConnected);

    expect(result).toBeNull();
    expect(matchService.createMatch).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it("matches a 'friends'-only candidate only when they ARE friends", async () => {
    seat(waiter({ userId: PEER_OID }));
    const joiner = waiter({ userId: JOINER_OID });
    seat(joiner);
    whoCanCallBy({ [PEER_OID]: 'friends', [JOINER_OID]: 'everyone' });
    friends.areFriends.mockResolvedValue(true);

    const result = await service.tryMatch(joiner, alwaysConnected);

    expect(result?.peer.userId).toBe(PEER_OID);
    // The 'friends' gate consults the friendship in the (caller, target) order.
    expect(friends.areFriends).toHaveBeenCalledWith(JOINER_OID, PEER_OID);
  });

  it("does NOT match a 'friends'-only candidate when they are NOT friends", async () => {
    seat(waiter({ userId: PEER_OID }));
    const joiner = waiter({ userId: JOINER_OID });
    seat(joiner);
    whoCanCallBy({ [PEER_OID]: 'friends', [JOINER_OID]: 'everyone' });
    friends.areFriends.mockResolvedValue(false);

    const result = await service.tryMatch(joiner, alwaysConnected);

    expect(result).toBeNull();
    expect(matchService.createMatch).not.toHaveBeenCalled();
  });

  it("enforces whoCanCall in BOTH directions (joiner 'nobody' blocks an 'everyone' peer)", async () => {
    seat(waiter({ userId: PEER_OID }));
    const joiner = waiter({ userId: JOINER_OID });
    seat(joiner);
    // Peer is open, but the JOINER accepts calls from nobody → still no match.
    whoCanCallBy({ [PEER_OID]: 'everyone', [JOINER_OID]: 'nobody' });

    const result = await service.tryMatch(joiner, alwaysConnected);

    expect(result).toBeNull();
  });

  it('defaults a settings-less candidate to whoCanCall:everyone so default/new users stay matchable', async () => {
    seat(waiter({ userId: PEER_OID }));
    const joiner = waiter({ userId: JOINER_OID });
    seat(joiner);
    // No settings document for anyone → must default to the PERMISSIVE 'everyone'
    // (NOT 'friends'); otherwise every brand-new / settings-less user is silently
    // un-matchable in the random roulette (the core flow breaks). Regression for
    // the whoCanCall default bug caught by the live 2-peer test.
    settingsFindOne.mockResolvedValue(null);
    friends.areFriends.mockResolvedValue(false);

    const result = await service.tryMatch(joiner, alwaysConnected);

    expect(result?.peer.userId).toBe(PEER_OID);
    expect(friends.areFriends).not.toHaveBeenCalled();
  });

  it('reads each whoCanCall at most once per pass (memoised across candidates)', async () => {
    // Two privacy-incompatible candidates plus the joiner; the joiner's own
    // setting must be read at most once even though it is checked per candidate.
    seat(waiter({ userId: PEER_OID }));
    seat(waiter({ userId: PEER_B_OID }));
    const joiner = waiter({ userId: JOINER_OID });
    seat(joiner);
    // Both peers are 'nobody' so nothing matches; joiner is 'everyone'.
    whoCanCallBy({ [PEER_OID]: 'nobody', [PEER_B_OID]: 'nobody', [JOINER_OID]: 'everyone' });

    await service.tryMatch(joiner, alwaysConnected);

    const queriedIds = settingsFindOne.mock.calls.map((c) =>
      (c[0] as { userId: { toString(): string } }).userId.toString(),
    );
    const joinerReads = queriedIds.filter((id) => id === JOINER_OID).length;
    expect(joinerReads).toBeLessThanOrEqual(1);
  });

  // ── canCallDirect — the PUBLIC whoCanCall gate for the direct call:invite ──
  // path. Same getWhoCanCall + areFriends logic the roulette uses, but a one-shot
  // (caller, callee) check the gateway consults before minting a pending call.
  // Closes the wave-5 privacy bypass where a 'nobody'/'friends' callee could be
  // rung directly by anyone who knew their userId. Reuses the OID ids so the real
  // settings-read path runs (invalid ids short-circuit to the 'friends' default).

  it("canCallDirect denies when the CALLEE's whoCanCall is 'nobody'", async () => {
    // Callee accepts calls from nobody; caller is open. Must deny.
    whoCanCallBy({ [JOINER_OID]: 'everyone', [PEER_OID]: 'nobody' });

    const allowed = await service.canCallDirect(JOINER_OID, PEER_OID);

    expect(allowed).toBe(false);
  });

  it("canCallDirect denies a 'friends'-only callee when the caller is NOT a friend", async () => {
    whoCanCallBy({ [JOINER_OID]: 'everyone', [PEER_OID]: 'friends' });
    friends.areFriends.mockResolvedValue(false);

    const allowed = await service.canCallDirect(JOINER_OID, PEER_OID);

    expect(allowed).toBe(false);
    // The 'friends' gate is consulted in the (caller, callee) order.
    expect(friends.areFriends).toHaveBeenCalledWith(JOINER_OID, PEER_OID);
  });

  it("canCallDirect ALLOWS a 'friends'-only callee when the caller IS a friend", async () => {
    // Caller is open ('everyone'); callee is friends-only and they ARE friends.
    whoCanCallBy({ [JOINER_OID]: 'everyone', [PEER_OID]: 'friends' });
    friends.areFriends.mockResolvedValue(true);

    const allowed = await service.canCallDirect(JOINER_OID, PEER_OID);

    expect(allowed).toBe(true);
    expect(friends.areFriends).toHaveBeenCalledWith(JOINER_OID, PEER_OID);
  });

  it("canCallDirect ALLOWS when both parties' whoCanCall is 'everyone' (no friendship lookup)", async () => {
    whoCanCallBy({ [JOINER_OID]: 'everyone', [PEER_OID]: 'everyone' });

    const allowed = await service.canCallDirect(JOINER_OID, PEER_OID);

    expect(allowed).toBe(true);
    // 'everyone' both ways never needs a friendship lookup.
    expect(friends.areFriends).not.toHaveBeenCalled();
  });

  it("canCallDirect is SYMMETRIC — a 'nobody' CALLER cannot ring an 'everyone' callee", async () => {
    // Mirrors the roulette's mutual gate: a caller who hid all calls can't dial.
    whoCanCallBy({ [JOINER_OID]: 'nobody', [PEER_OID]: 'everyone' });

    const allowed = await service.canCallDirect(JOINER_OID, PEER_OID);

    expect(allowed).toBe(false);
  });

  it('prefers a premium candidate when several are compatible (priority order)', async () => {
    // The pool is returned by zrange in PRIORITY order (premium sorts first via
    // its lower score). We model that ordering: premium peer is index 0.
    seat(waiter({ userId: 'premium-peer', isPremium: true, socketId: 'sock-prem' }));
    seat(waiter({ userId: 'regular-peer', isPremium: false, socketId: 'sock-reg' }));
    const joiner = waiter({ userId: 'joiner', socketId: 'sock-joiner' });
    seat(joiner);

    const result = await service.tryMatch(joiner, alwaysConnected);

    // The first compatible (highest-priority) candidate — the premium one — wins.
    expect(result?.peer.userId).toBe('premium-peer');
    expect(matchService.createMatch).toHaveBeenCalledWith(
      'premium-peer',
      'joiner',
      'video',
      joiner.filters,
    );
    // The regular peer is never claimed.
    expect(matchService.createMatch).toHaveBeenCalledTimes(1);
  });

  it('evicts a disconnected candidate and keeps scanning for a live peer', async () => {
    seat(waiter({ userId: 'ghost', socketId: 'sock-ghost' }));
    seat(waiter({ userId: 'live', socketId: 'sock-live' }));
    const joiner = waiter({ userId: 'joiner', socketId: 'sock-joiner' });
    seat(joiner);

    // Batched liveness: only the live peer holds a connection (the joiner is
    // never asked about — the matcher only checks candidates).
    const verifier = jest
      .fn<Promise<Set<string>>, [readonly string[]]>()
      .mockImplementation((ids: readonly string[]) =>
        Promise.resolve(new Set(ids.filter((id) => id === 'live'))),
      );

    const result = await service.tryMatch(joiner, verifier);

    expect(result?.peer.userId).toBe('live');
    // The dead candidate was evicted (its waiter hash + pool membership removed).
    expect(redis.multi).toHaveBeenCalled();
  });

  it('stops (returns null) if the joiner was already claimed by an opposite matcher', async () => {
    seat(waiter({ userId: 'peer' }));
    const joiner = waiter({ userId: 'joiner' });
    seat(joiner);
    // The claim loses the race for this pair...
    redis.eval.mockResolvedValueOnce(0);
    // ...and the joiner is no longer in the pool (claimed elsewhere).
    redis.zscore.mockImplementation((_k: string, member: string) =>
      Promise.resolve(member === 'joiner' ? null : 0),
    );

    const result = await service.tryMatch(joiner, alwaysConnected);

    expect(result).toBeNull();
    expect(matchService.createMatch).not.toHaveBeenCalled();
  });

  it('prunes a stale ZSET member whose waiter hash has expired', async () => {
    // 'phantom' is in the pool ordering but has no hash in the store.
    poolOrder.push('phantom');
    const joiner = waiter({ userId: 'joiner' });
    seat(joiner);

    const result = await service.tryMatch(joiner, alwaysConnected);

    expect(result).toBeNull();
    // The phantom member is ZREM'd directly off the pool.
    expect(redis.zrem).toHaveBeenCalledWith(poolKey('video'), 'phantom');
  });

  // ── Batched hot-path topology (speed-only refactor) ────────────────────────
  // These pin the new await topology: one MGET for every candidate hash and a
  // single batched liveness call per pass, instead of N serial GETs + N
  // per-candidate fetchSockets round-trips. Behaviour is unchanged — they assert
  // the BATCHING, not new matching semantics.

  it('loads all candidate waiter hashes in a single MGET (no per-candidate GET)', async () => {
    seat(waiter({ userId: 'peer-a', socketId: 'sock-a' }));
    seat(waiter({ userId: 'peer-b', socketId: 'sock-b' }));
    const joiner = waiter({ userId: 'joiner', socketId: 'sock-joiner' });
    seat(joiner);

    await service.tryMatch(joiner, alwaysConnected);

    // One batched read covers the whole candidate set (self filtered out before
    // the MGET, so the joiner's own key is not fetched).
    expect(redis.mget).toHaveBeenCalledTimes(1);
    const requestedKeys = redis.mget.mock.calls[0]?.[0] as string[];
    expect(requestedKeys).toEqual([waiterKey('peer-a'), waiterKey('peer-b')]);
    expect(requestedKeys).not.toContain(waiterKey('joiner'));
  });

  it('checks liveness in ONE batched call carrying every scanned candidate id', async () => {
    seat(waiter({ userId: 'peer-a', socketId: 'sock-a' }));
    seat(waiter({ userId: 'peer-b', socketId: 'sock-b' }));
    const joiner = waiter({ userId: 'joiner', socketId: 'sock-joiner' });
    seat(joiner);

    const verifier = jest
      .fn<Promise<Set<string>>, [readonly string[]]>()
      .mockImplementation((ids: readonly string[]) => Promise.resolve(new Set(ids)));

    await service.tryMatch(joiner, verifier);

    // Liveness is resolved once for the whole pass, not per candidate.
    expect(verifier).toHaveBeenCalledTimes(1);
    const askedIds = verifier.mock.calls[0]?.[0] as readonly string[];
    // Both compatible candidates are asked about; the joiner is never asked
    // (the matcher only checks candidates, not itself).
    expect([...askedIds].sort()).toEqual(['peer-a', 'peer-b']);
    expect(askedIds).not.toContain('joiner');
  });

  it('still reads each whoCanCall at most once even with parallel gate evaluation', async () => {
    // Two privacy-incompatible candidates; the parallel block/privacy gate could
    // race two reads of the JOINER's setting, but the promise-memoising cache
    // collapses them to exactly one settings read.
    seat(waiter({ userId: PEER_OID }));
    seat(waiter({ userId: PEER_B_OID }));
    const joiner = waiter({ userId: JOINER_OID });
    seat(joiner);
    whoCanCallBy({ [PEER_OID]: 'nobody', [PEER_B_OID]: 'nobody', [JOINER_OID]: 'everyone' });

    await service.tryMatch(joiner, alwaysConnected);

    const queriedIds = settingsFindOne.mock.calls.map((c) =>
      (c[0] as { userId: { toString(): string } }).userId.toString(),
    );
    const joinerReads = queriedIds.filter((id) => id === JOINER_OID).length;
    expect(joinerReads).toBeLessThanOrEqual(1);
  });

  // ── Interest-aware matching (the differentiator) ───────────────────────────

  it('prefers the candidate with MORE shared interests over a higher-priority one', async () => {
    // 'plain' sits FIRST in the pool (higher base priority) but shares nothing;
    // 'kindred' sits later but shares two interests with the joiner. Interests
    // override the base priority when sharedInterestsOnly is OFF.
    seat(waiter({ userId: 'plain', socketId: 'sock-plain', interests: ['sports'] }));
    seat(
      waiter({
        userId: 'kindred',
        socketId: 'sock-kindred',
        interests: ['music', 'gaming'],
      }),
    );
    const joiner = waiter({
      userId: 'joiner',
      socketId: 'sock-joiner',
      interests: ['music', 'gaming', 'travel'],
    });
    seat(joiner);

    const result = await service.tryMatch(joiner, alwaysConnected);

    // The higher-overlap candidate wins despite its lower pool position.
    expect(result?.peer.userId).toBe('kindred');
    expect(matchService.createMatch).toHaveBeenCalledWith(
      'kindred',
      'joiner',
      'video',
      joiner.filters,
    );
    expect(matchService.createMatch).toHaveBeenCalledTimes(1);
  });

  it('falls back to pool priority when nobody shares an interest (overlap all 0)', async () => {
    // No overlap anywhere → ranking collapses to the original priority order,
    // so the first-seated candidate (highest priority) is chosen.
    seat(waiter({ userId: 'first', socketId: 'sock-first', interests: ['sports'] }));
    seat(waiter({ userId: 'second', socketId: 'sock-second', interests: ['cooking'] }));
    const joiner = waiter({ userId: 'joiner', socketId: 'sock-joiner', interests: ['music'] });
    seat(joiner);

    const result = await service.tryMatch(joiner, alwaysConnected);

    expect(result?.peer.userId).toBe('first');
  });

  it('still matches when BOTH parties have no interests (interests only prioritise)', async () => {
    // The backward-compatible baseline: empty interests must never block a match
    // while sharedInterestsOnly is off.
    seat(waiter({ userId: 'peer', socketId: 'sock-peer', interests: [] }));
    const joiner = waiter({ userId: 'joiner', socketId: 'sock-joiner', interests: [] });
    seat(joiner);

    const result = await service.tryMatch(joiner, alwaysConnected);

    expect(result?.peer.userId).toBe('peer');
    expect(matchService.createMatch).toHaveBeenCalledTimes(1);
  });

  it('with sharedInterestsOnly REQUIRES overlap: pairs only the candidate who shares one', async () => {
    // 'stranger' shares nothing; 'kindred' shares one. The joiner demands shared
    // interests, so only 'kindred' is eligible — even though 'stranger' is
    // otherwise fully compatible and higher in the pool.
    seat(waiter({ userId: 'stranger', socketId: 'sock-stranger', interests: ['sports'] }));
    seat(waiter({ userId: 'kindred', socketId: 'sock-kindred', interests: ['music'] }));
    const joiner = waiter({
      userId: 'joiner',
      socketId: 'sock-joiner',
      interests: ['music', 'travel'],
      filters: filters({ sharedInterestsOnly: true }),
    });
    seat(joiner);

    const result = await service.tryMatch(joiner, alwaysConnected);

    expect(result?.peer.userId).toBe('kindred');
    // 'stranger' must never be claimed (no shared interest).
    expect(matchService.createMatch).toHaveBeenCalledTimes(1);
    expect(matchService.createMatch).toHaveBeenCalledWith(
      'kindred',
      'joiner',
      'video',
      joiner.filters,
    );
  });

  it('with sharedInterestsOnly matches NOBODY when no waiting peer shares an interest', async () => {
    seat(waiter({ userId: 'stranger', socketId: 'sock-stranger', interests: ['sports', 'art'] }));
    const joiner = waiter({
      userId: 'joiner',
      socketId: 'sock-joiner',
      interests: ['music', 'travel'],
      filters: filters({ sharedInterestsOnly: true }),
    });
    seat(joiner);

    const result = await service.tryMatch(joiner, alwaysConnected);

    expect(result).toBeNull();
    expect(matchService.createMatch).not.toHaveBeenCalled();
    // No eligible candidate → the claim script never runs.
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('with sharedInterestsOnly, a joiner who has NO interests matches nobody', async () => {
    // Explicit opt-in semantic: requiring shared interests while having none of
    // your own means there can be no overlap, so no candidate qualifies.
    seat(waiter({ userId: 'peer', socketId: 'sock-peer', interests: ['music'] }));
    const joiner = waiter({
      userId: 'joiner',
      socketId: 'sock-joiner',
      interests: [],
      filters: filters({ sharedInterestsOnly: true }),
    });
    seat(joiner);

    const result = await service.tryMatch(joiner, alwaysConnected);

    expect(result).toBeNull();
    expect(matchService.createMatch).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// enqueue — premium waiters get a priority-boosted (lower) ZSET score so they
// sort ahead in the pool that tryMatch scans.
// ─────────────────────────────────────────────────────────────────────────────
describe('MatchmakingService.enqueue — premium priority scoring', () => {
  let service: MatchmakingService;
  let zaddCalls: Array<[string, number, string]>;
  let setCalls: Array<unknown[]>;
  let premium: { isPremium: jest.Mock };

  function buildService(): MatchmakingService {
    zaddCalls = [];
    setCalls = [];
    const pipeline = {
      set: jest.fn().mockImplementation((...args: unknown[]) => {
        setCalls.push(args);
        return pipeline;
      }),
      zadd: jest.fn().mockImplementation((key: string, score: number, member: string) => {
        zaddCalls.push([key, score, member]);
        return pipeline;
      }),
      exec: jest.fn().mockResolvedValue([]),
    };
    const redis = { multi: jest.fn().mockReturnValue(pipeline) };
    const profiles = {
      // The enqueue path now resolves country from THIS single read (no second
      // getPublicProfile round-trip), so the mock returns country too.
      getAgeAndGender: jest
        .fn()
        .mockResolvedValue({ age: 28, gender: 'female', country: 'RU', interests: [] }),
      getPublicProfile: jest.fn().mockResolvedValue({
        id: 'u',
        nickname: 'n',
        age: 28,
        gender: 'female',
        country: 'RU',
        avatarUrl: null,
        badges: [],
        isPremium: false,
      }),
    };
    const blocks = { isBlocked: jest.fn().mockResolvedValue(false) };
    const friends = { areFriends: jest.fn().mockResolvedValue(false) };
    const connection = {
      collection: jest.fn().mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) }),
    };
    return new MatchmakingService(
      redis as never,
      { createMatch: jest.fn(), endMatch: jest.fn() } as never,
      profiles as never,
      blocks as never,
      premium as never,
      friends as never,
      connection as never,
    );
  }

  /** The score of the single zadd recorded this enqueue (asserts exactly one). */
  function soleZaddScore(): number {
    expect(zaddCalls).toHaveLength(1);
    const [call] = zaddCalls;
    if (!call) {
      throw new Error('expected a zadd call');
    }
    return call[1];
  }

  it('gives a premium waiter a strictly lower (earlier) score than a non-premium one at the same instant', async () => {
    const joinedAt = 1_700_000_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(joinedAt);

    // Non-premium enqueue.
    premium = { isPremium: jest.fn().mockResolvedValue(false) };
    let svc = buildService();
    await svc.enqueue(
      'u-reg',
      'video' as MatchType,
      {
        gender: 'any',
        ageMin: 18,
        ageMax: 120,
        countries: [],
        sharedInterestsOnly: false,
      },
      'sock-reg',
    );
    const regularScore = soleZaddScore();

    // Premium enqueue at the SAME instant.
    premium = { isPremium: jest.fn().mockResolvedValue(true) };
    svc = buildService();
    await svc.enqueue(
      'u-prem',
      'video' as MatchType,
      {
        gender: 'any',
        ageMin: 18,
        ageMax: 120,
        countries: [],
        sharedInterestsOnly: false,
      },
      'sock-prem',
    );
    const premiumScore = soleZaddScore();

    // Lower score = served first → premium must sort strictly ahead.
    expect(premiumScore).toBeLessThan(regularScore);
    // Non-premium score is exactly joinedAt (no bonus subtracted).
    expect(regularScore).toBe(joinedAt);

    nowSpy.mockRestore();
  });

  it('resolves country from the single getAgeAndGender read (no second profile lookup)', async () => {
    premium = { isPremium: jest.fn().mockResolvedValue(false) };
    const svc = buildService();
    const profiles = (
      svc as unknown as {
        profiles: { getAgeAndGender: jest.Mock; getPublicProfile: jest.Mock };
      }
    ).profiles;
    profiles.getAgeAndGender.mockResolvedValue({
      age: 28,
      gender: 'female',
      country: 'BY',
      interests: [],
    });

    const entry = await svc.enqueue(
      'u-country',
      'video' as MatchType,
      {
        gender: 'any',
        ageMin: 18,
        ageMax: 120,
        countries: [],
        sharedInterestsOnly: false,
      },
      'sock',
    );

    // Country comes from the demographics read…
    expect(entry?.country).toBe('BY');
    // …and the enqueue path no longer issues a second getPublicProfile just for it.
    expect(profiles.getPublicProfile).not.toHaveBeenCalled();
    expect(profiles.getAgeAndGender).toHaveBeenCalledTimes(1);
  });

  it('returns null and does not enqueue a user with no profile', async () => {
    premium = { isPremium: jest.fn().mockResolvedValue(false) };
    const svc = buildService();
    // Force getAgeAndGender to reject (no profile).
    (svc as unknown as { profiles: { getAgeAndGender: jest.Mock } }).profiles.getAgeAndGender = jest
      .fn()
      .mockRejectedValue(new Error('not found'));

    const entry = await svc.enqueue(
      'ghost',
      'video' as MatchType,
      {
        gender: 'any',
        ageMin: 18,
        ageMax: 120,
        countries: [],
        sharedInterestsOnly: false,
      },
      'sock',
    );

    expect(entry).toBeNull();
    expect(zaddCalls).toHaveLength(0);
  });

  // ── Premium entitlement on the matchmaking filters ─────────────────────────
  // The gender / country / shared-interest filters are an ADVERTISED premium
  // perk ("Gender & country filters"). A non-premium user's request for them is
  // coerced to the open defaults at the enqueue choke point BEFORE entering the
  // pool; a premium user's is honored verbatim. The always-free age window is
  // preserved in both cases.

  /** The premium-gated filters a non-premium user demands, plus a custom age. */
  const PREMIUM_FILTERS = {
    gender: 'female' as const,
    ageMin: 21,
    ageMax: 35,
    countries: ['RU', 'BY'],
    sharedInterestsOnly: true,
  };

  it('IGNORES a non-premium user\'s gender/country/shared-interest filters (coerced to open defaults)', async () => {
    premium = { isPremium: jest.fn().mockResolvedValue(false) };
    const svc = buildService();

    const entry = await svc.enqueue('u-free', 'video' as MatchType, PREMIUM_FILTERS, 'sock');

    // Premium-only dimensions reset to their open defaults…
    expect(entry?.filters.gender).toBe('any');
    expect(entry?.filters.countries).toEqual([]);
    expect(entry?.filters.sharedInterestsOnly).toBe(false);
    // …while the always-free age window is preserved untouched.
    expect(entry?.filters.ageMin).toBe(21);
    expect(entry?.filters.ageMax).toBe(35);
  });

  it("HONORS a premium user's gender/country/shared-interest filters verbatim", async () => {
    premium = { isPremium: jest.fn().mockResolvedValue(true) };
    const svc = buildService();

    const entry = await svc.enqueue('u-prem', 'video' as MatchType, PREMIUM_FILTERS, 'sock');

    // A premium user gets exactly what they asked for.
    expect(entry?.filters.gender).toBe('female');
    expect(entry?.filters.countries).toEqual(['RU', 'BY']);
    expect(entry?.filters.sharedInterestsOnly).toBe(true);
    expect(entry?.filters.ageMin).toBe(21);
    expect(entry?.filters.ageMax).toBe(35);
  });

  it('coerces filters to open defaults when the premium check FAILS (fail-closed entitlement)', async () => {
    // A premium-service blip resolves non-premium (safeIsPremium), so the perk
    // is NOT granted — the filters are coerced. No free filtering on errors.
    premium = { isPremium: jest.fn().mockRejectedValue(new Error('premium down')) };
    const svc = buildService();

    const entry = await svc.enqueue('u-err', 'video' as MatchType, PREMIUM_FILTERS, 'sock');

    expect(entry?.filters.gender).toBe('any');
    expect(entry?.filters.countries).toEqual([]);
    expect(entry?.filters.sharedInterestsOnly).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// consumeNextToken — fixed-window rate limit for `mm:next`.
// ─────────────────────────────────────────────────────────────────────────────
describe('MatchmakingService.consumeNextToken — mm:next rate limiting', () => {
  let service: MatchmakingService;
  let redis: { incr: jest.Mock; expire: jest.Mock };
  const userId = 'rate-user';

  function build(): MatchmakingService {
    return new MatchmakingService(
      redis as never,
      { createMatch: jest.fn(), endMatch: jest.fn() } as never,
      { getAgeAndGender: jest.fn(), getPublicProfile: jest.fn() } as never,
      { isBlocked: jest.fn() } as never,
      { isPremium: jest.fn() } as never,
      { areFriends: jest.fn() } as never,
      { collection: jest.fn() } as never,
    );
  }

  beforeEach(() => {
    redis = { incr: jest.fn(), expire: jest.fn().mockResolvedValue(1) };
    service = build();
  });

  it('allows the first call and sets the window TTL exactly once (on the first hit)', async () => {
    redis.incr.mockResolvedValue(1);

    await expect(service.consumeNextToken(userId)).resolves.toBe(true);

    expect(redis.incr).toHaveBeenCalledWith(nextRateKey(userId));
    // Window TTL is applied only when the counter is created (count === 1).
    expect(redis.expire).toHaveBeenCalledWith(nextRateKey(userId), NEXT_WINDOW_SECONDS);
  });

  it('does NOT reset the TTL on subsequent in-window calls', async () => {
    redis.incr.mockResolvedValue(5); // already mid-window

    await expect(service.consumeNextToken(userId)).resolves.toBe(true);

    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('allows exactly NEXT_MAX_PER_WINDOW calls and rejects the next', async () => {
    redis.incr.mockResolvedValue(NEXT_MAX_PER_WINDOW); // the boundary call
    await expect(service.consumeNextToken(userId)).resolves.toBe(true);

    redis.incr.mockResolvedValue(NEXT_MAX_PER_WINDOW + 1); // one over
    await expect(service.consumeNextToken(userId)).resolves.toBe(false);
  });

  it('keeps rejecting while the counter stays above the limit within the window', async () => {
    redis.incr.mockResolvedValue(NEXT_MAX_PER_WINDOW + 7);
    await expect(service.consumeNextToken(userId)).resolves.toBe(false);
    // Throttled calls must NOT re-arm the TTL (that would extend the window).
    expect(redis.expire).not.toHaveBeenCalled();
  });
});
