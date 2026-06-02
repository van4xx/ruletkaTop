import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { Redis } from 'ioredis';

import type {
  MatchEndReason,
  MatchFilters,
  MatchType,
  PeerInfo,
  Visibility,
} from '@ruletka/shared-types';

import { REDIS_CLIENT } from '../../redis/redis.constants';
import {
  BLOCKS_SERVICE,
  type BlocksServiceContract,
  FRIENDS_SERVICE,
  type FriendsServiceContract,
  PREMIUM_SERVICE,
  type PremiumServiceContract,
  PROFILES_SERVICE,
  type ProfilesServiceContract,
} from './contracts/external-services';
import { MatchService } from './match.service';
import {
  MATCH_CANDIDATE_BATCH,
  NEXT_MAX_PER_WINDOW,
  NEXT_WINDOW_SECONDS,
  nextRateKey,
  poolKey,
  PREMIUM_PRIORITY_BONUS,
  ROOM_TTL_SECONDS,
  roomKey,
  userRoomKey,
  WAITER_TTL_SECONDS,
  waiterKey,
} from './matchmaking.constants';
import type { RoomState, UserRoomPointer, WaiterEntry } from './matchmaking.types';

/** Predicate the gateway supplies so the matcher can skip dead candidate sockets. */
export type ConnectionVerifier = (socketId: string) => Promise<boolean>;

/** Result of a successful pairing — everything the gateway needs to wire the room. */
export interface MatchResult {
  roomId: string;
  matchId: string;
  type: MatchType;
  /** The peer the joiner was matched with (their waiter entry). */
  peer: WaiterEntry;
  /** Public peer info for the JOINER's overlay (built from `peer`). */
  peerInfoForJoiner: PeerInfo;
  /** Public peer info for the PEER's overlay (built from the joiner). */
  peerInfoForPeer: PeerInfo;
}

/** Outcome of teardown — who the peer was, so the gateway can notify them. */
export interface TeardownResult {
  roomId: string;
  type: MatchType;
  /** The OTHER participant (not the user who triggered teardown). */
  peerUserId: string;
  /** Match duration (ms) if the durable row was closed by this call, else null. */
  durationMs: number | null;
}

/**
 * Redis-backed matchmaking pool + room registry — the live counterpart to the
 * durable {@link MatchService} log.
 *
 * Responsibilities:
 * - enqueue a user into a per-modality pool ({@link enqueue}),
 * - atomically find a MUTUALLY-compatible, non-blocked, connected peer that
 *   each party's `whoCanCall` privacy permits, with premium priority
 *   ({@link tryMatch}); on success persist a {@link Match} and register the room,
 * - resolve / tear down rooms ({@link teardownRoom}, {@link getUserRoom}),
 * - remove abandoned waiters ({@link dequeue}),
 * - rate-limit `mm:next` ({@link consumeNextToken}).
 *
 * All multi-key state changes that must not race across nodes go through Lua
 * (claiming a candidate via `ZREM`, removing a waiter, deleting a room) so two
 * concurrent joiners can never grab the same waiter.
 */
@Injectable()
export class MatchmakingService {
  private readonly logger = new Logger(MatchmakingService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly matchService: MatchService,
    @Inject(PROFILES_SERVICE) private readonly profiles: ProfilesServiceContract,
    @Inject(BLOCKS_SERVICE) private readonly blocks: BlocksServiceContract,
    @Inject(PREMIUM_SERVICE) private readonly premium: PremiumServiceContract,
    @Inject(FRIENDS_SERVICE) private readonly friends: FriendsServiceContract,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  // ── Enqueue ────────────────────────────────────────────────────────────────

  /**
   * Place a user into the pool for `type`. Loads their demographics + premium
   * flag (the facts a peer's filters are tested against), writes the waiter
   * hash with a TTL and adds them to the priority-scored ZSET. Idempotent: a
   * re-join overwrites the prior entry (e.g. reconnect with a new socket).
   *
   * @returns the built {@link WaiterEntry}, or `null` if the user has no profile
   *   (cannot be matched).
   */
  async enqueue(
    userId: string,
    type: MatchType,
    filters: MatchFilters,
    socketId: string,
  ): Promise<WaiterEntry | null> {
    let demographics: { age: number; gender: PeerInfo['gender']; interests: string[] };
    try {
      demographics = await this.profiles.getAgeAndGender(userId);
    } catch (err) {
      this.logger.debug(`enqueue: no profile for ${userId}: ${asMessage(err)}`);
      return null;
    }

    const isPremium = await this.safeIsPremium(userId);
    const entry: WaiterEntry = {
      userId,
      type,
      filters,
      age: demographics.age,
      gender: demographics.gender,
      country: await this.resolveCountry(userId),
      // Stored normalised by the profiles layer; default to [] for safety.
      interests: demographics.interests ?? [],
      isPremium,
      socketId,
      joinedAt: Date.now(),
    };

    // Premium sorts ahead (lower score served first); FIFO within a bucket.
    const score = entry.joinedAt - (isPremium ? PREMIUM_PRIORITY_BONUS : 0);
    const pipeline = this.redis.multi();
    pipeline.set(waiterKey(userId), JSON.stringify(entry), 'EX', WAITER_TTL_SECONDS);
    pipeline.zadd(poolKey(type), score, userId);
    await pipeline.exec();
    return entry;
  }

  // ── Match ────────────────────────────────────────────────────────────────

  /**
   * Try to pair `joiner` with the best peer currently waiting for the same
   * `type`. Scans up to {@link MATCH_CANDIDATE_BATCH} candidates in pool-priority
   * order and keeps those that (a) are not self, (b) are still connected, (c) are
   * not blocked either way, (d) are MUTUALLY filter-compatible and (e) are
   * permitted by BOTH parties' `whoCanCall` privacy.
   *
   * Interest-aware ranking (the differentiator):
   *  - If the JOINER's `filters.sharedInterestsOnly` is set, a candidate with NO
   *    shared interest is REJECTED outright (same as any other gate). A joiner
   *    with no interests of their own therefore matches nobody while that flag
   *    is on — that is the explicit opt-in semantic.
   *  - Otherwise interests only PRIORITISE: among the eligible candidates we pick
   *    the one with the MOST shared interests, breaking ties by the existing pool
   *    priority (premium-first, then FIFO) — i.e. the order `zrange` returned.
   *    A candidate (or joiner) with no interests scores 0 overlap and still
   *    matches when nothing better is waiting.
   *
   * We then attempt to CLAIM candidates in that ranked order (atomic `ZREM` of
   * both from the pool). On a claim we persist a {@link Match}, register the room
   * in Redis and return the result. The Redis pool structure is unchanged — we
   * only re-rank the already-scanned batch in memory.
   *
   * The joiner must already be enqueued (so a simultaneous opposite-direction
   * `tryMatch` can find THEM). If no peer is found the joiner simply stays
   * queued and `null` is returned.
   */
  async tryMatch(joiner: WaiterEntry, isConnected: ConnectionVerifier): Promise<MatchResult | null> {
    const pool = poolKey(joiner.type);
    // Lowest scores first = highest priority / earliest.
    const candidateIds = await this.redis.zrange(pool, 0, MATCH_CANDIDATE_BATCH - 1);

    // Per-pass cache of each user's `whoCanCall` privacy so a scan over many
    // candidates loads any given user's setting at most once (the joiner's is
    // read once and reused against every candidate).
    const whoCanCallCache = new Map<string, Visibility>();

    // Whether this joiner demands shared interests (backward-compatible: an
    // entry persisted before the field existed has `sharedInterestsOnly`
    // undefined → treated as false, i.e. interests only prioritise).
    const requireShared = joiner.filters.sharedInterestsOnly === true;

    // Gather eligible candidates (passing every gate) tagged with their batch
    // index (= pool priority) and their shared-interest count, so we can rank
    // by overlap while keeping priority/FIFO as the tiebreak.
    const eligible: Array<{ candidate: WaiterEntry; priority: number; shared: number }> = [];

    for (let i = 0; i < candidateIds.length; i++) {
      const candidateId = candidateIds[i];
      if (candidateId === undefined || candidateId === joiner.userId) {
        continue;
      }
      const candidate = await this.getWaiter(candidateId);
      if (!candidate) {
        // Stale ZSET member with no hash — prune it.
        await this.redis.zrem(pool, candidateId);
        continue;
      }
      if (candidate.type !== joiner.type) {
        continue;
      }
      if (!areMutuallyCompatible(joiner, candidate)) {
        continue;
      }
      const shared = sharedInterestCount(joiner.interests, candidate.interests);
      // `sharedInterestsOnly` gate — skip candidates with zero overlap, exactly
      // like the demographic/privacy gates above.
      if (requireShared && shared === 0) {
        continue;
      }
      if (!(await isConnected(candidate.socketId))) {
        // Candidate's socket is gone — evict and keep scanning.
        await this.removeWaiter(candidateId, candidate.type);
        continue;
      }
      if (await this.blocks.isBlocked(joiner.userId, candidate.userId)) {
        continue;
      }
      // Privacy gate, mirroring chat's `canMessage`: BOTH sides must permit the
      // other to call them (`whoCanCall` of 'everyone' | 'friends' | 'nobody').
      if (!(await this.mutualCanCall(joiner.userId, candidate.userId, whoCanCallCache))) {
        continue;
      }

      eligible.push({ candidate, priority: i, shared });
    }

    // Rank: most shared interests first, then original pool priority (premium,
    // then FIFO). A stable sort on a priority-ordered batch keeps FIFO within an
    // equal-overlap group. With `sharedInterestsOnly` off and no overlap anywhere
    // this collapses to the original priority order (overlap all 0).
    eligible.sort((a, b) => (b.shared - a.shared) || (a.priority - b.priority));

    for (const { candidate } of eligible) {
      // Atomically CLAIM both: only the caller that removes BOTH owns the pair.
      const claimed = await this.claimPair(joiner.type, joiner.userId, candidate.userId);
      if (claimed) {
        return this.commitMatch(joiner, candidate);
      }

      // Lost the race for this pair. If the JOINER themselves was claimed (i.e.
      // an opposite-direction matcher already paired them), stop — they're
      // matched elsewhere and we must not double-match. Otherwise only the
      // candidate was taken; keep trying the next-best eligible peer.
      if (!(await this.isQueued(joiner.userId, joiner.type))) {
        return null;
      }
    }

    return null;
  }

  /** Whether a user is still a member of the given pool (claim-race check). */
  private async isQueued(userId: string, type: MatchType): Promise<boolean> {
    const score = await this.redis.zscore(poolKey(type), userId);
    return score !== null;
  }

  /**
   * Persist the durable match row, build both peer overlays and register the
   * room + per-user pointers in Redis. Called only after a successful claim.
   */
  private async commitMatch(joiner: WaiterEntry, peer: WaiterEntry): Promise<MatchResult> {
    const roomId = randomUUID();
    // userA = the one already waiting (peer), userB = the joiner (matches the
    // MatchService contract and the Match schema's filtersSnapshot = joiner's).
    const matchId = await this.matchService.createMatch(
      peer.userId,
      joiner.userId,
      joiner.type,
      joiner.filters,
    );

    const room: RoomState = {
      roomId,
      type: joiner.type,
      matchId,
      userA: peer.userId,
      userB: joiner.userId,
      createdAt: Date.now(),
    };
    const joinerPointer: UserRoomPointer = {
      roomId,
      filters: joiner.filters,
      type: joiner.type,
    };
    const peerPointer: UserRoomPointer = {
      roomId,
      filters: peer.filters,
      type: peer.type,
    };

    const pipeline = this.redis.multi();
    pipeline.set(roomKey(roomId), JSON.stringify(room), 'EX', ROOM_TTL_SECONDS);
    pipeline.set(userRoomKey(joiner.userId), JSON.stringify(joinerPointer), 'EX', ROOM_TTL_SECONDS);
    pipeline.set(userRoomKey(peer.userId), JSON.stringify(peerPointer), 'EX', ROOM_TTL_SECONDS);
    await pipeline.exec();

    const [peerInfoForJoiner, peerInfoForPeer] = await Promise.all([
      this.buildPeerInfo(peer),
      this.buildPeerInfo(joiner),
    ]);

    this.logger.debug(
      `matched room=${roomId} type=${joiner.type} userA=${peer.userId} userB=${joiner.userId}`,
    );

    return { roomId, matchId, type: joiner.type, peer, peerInfoForJoiner, peerInfoForPeer };
  }

  // ── Room resolution / teardown ──────────────────────────────────────────────

  /** The room a user is currently in (with their join-time filters), or `null`. */
  async getUserRoom(userId: string): Promise<UserRoomPointer | null> {
    const raw = await this.redis.get(userRoomKey(userId));
    return raw ? (safeParse<UserRoomPointer>(raw) ?? null) : null;
  }

  /** The full room state for a room id, or `null` if it no longer exists. */
  async getRoom(roomId: string): Promise<RoomState | null> {
    const raw = await this.redis.get(roomKey(roomId));
    return raw ? (safeParse<RoomState>(raw) ?? null) : null;
  }

  /**
   * Whether `userId` is a member of `roomId` per the authoritative Redis room
   * state. Used to gate signaling relays (offer/answer/ice/hangup).
   */
  async isMember(roomId: string, userId: string): Promise<boolean> {
    const room = await this.getRoom(roomId);
    return room !== null && (room.userA === userId || room.userB === userId);
  }

  /** The peer of `userId` within `roomId`, or `null` if not a member / no room. */
  async getPeerOf(roomId: string, userId: string): Promise<string | null> {
    const room = await this.getRoom(roomId);
    if (!room) {
      return null;
    }
    if (room.userA === userId) {
      return room.userB;
    }
    if (room.userB === userId) {
      return room.userA;
    }
    return null;
  }

  /**
   * Tear down the room `userId` is in: atomically delete the room hash + both
   * user→room pointers (idempotent across racing hangup/disconnect signals) and
   * close the durable {@link Match}. Returns who the peer was so the gateway can
   * notify them, or `null` if there was no active room.
   *
   * @param reason why the session ended (stamped on the Match row).
   */
  async teardownRoom(userId: string, reason: MatchEndReason): Promise<TeardownResult | null> {
    const pointer = await this.getUserRoom(userId);
    if (!pointer) {
      return null;
    }
    const room = await this.getRoom(pointer.roomId);
    if (!room) {
      // Pointer dangling without a room — clean it and bail.
      await this.redis.del(userRoomKey(userId));
      return null;
    }

    const peerUserId = room.userA === userId ? room.userB : room.userA;

    // Atomic multi-key delete so a racing teardown closes the match only once.
    const deleted = await this.deleteRoom(room.roomId, room.userA, room.userB);
    let durationMs: number | null = null;
    if (deleted) {
      durationMs = await this.matchService.endMatch(room.matchId, reason);
    }

    return { roomId: room.roomId, type: room.type, peerUserId, durationMs };
  }

  // ── Dequeue ────────────────────────────────────────────────────────────────

  /** Remove a user from ALL pools (disconnect — we may not know their type). */
  async dequeueAll(userId: string): Promise<void> {
    const pipeline = this.redis.multi();
    pipeline.del(waiterKey(userId));
    pipeline.zrem(poolKey('video'), userId);
    pipeline.zrem(poolKey('voice'), userId);
    await pipeline.exec();
  }

  // ── Rate limiting ────────────────────────────────────────────────────────────

  /**
   * Consume one `mm:next` token in a fixed window. Returns `true` if allowed,
   * `false` if the user exceeded {@link NEXT_MAX_PER_WINDOW} within
   * {@link NEXT_WINDOW_SECONDS}. INCR + first-hit EXPIRE is atomic enough here:
   * the window resets once the key lapses.
   */
  async consumeNextToken(userId: string): Promise<boolean> {
    const key = nextRateKey(userId);
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, NEXT_WINDOW_SECONDS);
    }
    return count <= NEXT_MAX_PER_WINDOW;
  }

  // ── Privacy (whoCanCall) gating ──────────────────────────────────────────────

  /**
   * Whether `a` and `b` may be matched given BOTH parties' `whoCanCall`
   * privacy. Symmetric: each must independently permit the other to call them.
   * The `cache` memoises each user's `whoCanCall` for the duration of one match
   * pass so scanning many candidates never re-reads the same user's setting.
   */
  private async mutualCanCall(
    a: string,
    b: string,
    cache: Map<string, Visibility>,
  ): Promise<boolean> {
    return (await this.canCall(a, b, cache)) && (await this.canCall(b, a, cache));
  }

  /**
   * Whether `target` permits `caller` to be matched into a call with them, per
   * `target`'s `whoCanCall`: 'nobody' → never, 'friends' → only accepted
   * friends, 'everyone' → always.
   */
  private async canCall(
    caller: string,
    target: string,
    cache: Map<string, Visibility>,
  ): Promise<boolean> {
    const visibility = await this.cachedWhoCanCall(target, cache);
    if (visibility === 'nobody') {
      return false;
    }
    if (visibility === 'friends') {
      return this.friends.areFriends(caller, target);
    }
    return true; // 'everyone'
  }

  /** Read `whoCanCall` for a user, memoising the result in `cache`. */
  private async cachedWhoCanCall(
    userId: string,
    cache: Map<string, Visibility>,
  ): Promise<Visibility> {
    const cached = cache.get(userId);
    if (cached) {
      return cached;
    }
    const visibility = await this.getWhoCanCall(userId);
    cache.set(userId, visibility);
    return visibility;
  }

  /**
   * Read a user's `whoCanCall` privacy directly from the `settings` collection
   * (defaulting to the schema default `friends`). Read directly — rather than
   * via a hard DI dependency on the settings module — mirroring how
   * {@link ChatService} reads `whoCanMessage`.
   */
  private async getWhoCanCall(userId: string): Promise<Visibility> {
    if (!Types.ObjectId.isValid(userId)) {
      return 'friends';
    }
    const doc = await this.connection
      .collection('settings')
      .findOne(
        { userId: new Types.ObjectId(userId) },
        { projection: { 'privacy.whoCanCall': 1 } },
      );
    const value = (doc?.privacy as { whoCanCall?: Visibility } | undefined)?.whoCanCall;
    return value ?? 'friends';
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  /** Load and parse a waiter hash, or `null` if missing / corrupt. */
  private async getWaiter(userId: string): Promise<WaiterEntry | null> {
    const raw = await this.redis.get(waiterKey(userId));
    return raw ? (safeParse<WaiterEntry>(raw) ?? null) : null;
  }

  /** Remove a waiter's hash and pool membership (single type). */
  private async removeWaiter(userId: string, type: MatchType): Promise<void> {
    const pipeline = this.redis.multi();
    pipeline.del(waiterKey(userId));
    pipeline.zrem(poolKey(type), userId);
    await pipeline.exec();
  }

  /**
   * Atomically claim a pair: remove BOTH user ids from the pool ZSET and their
   * waiter hashes, but only if BOTH were still present. Returns true on a clean
   * claim, false if either had already been taken (lost the race).
   */
  private async claimPair(type: MatchType, a: string, b: string): Promise<boolean> {
    const result = (await this.redis.eval(
      CLAIM_PAIR_LUA,
      3,
      // KEYS: pool zset + both waiter hashes (all mutated by the script).
      poolKey(type),
      waiterKey(a),
      waiterKey(b),
      // ARGV: the two user ids (pool ZSET members).
      a,
      b,
    )) as number;
    return result === 1;
  }

  /**
   * Atomically delete a room + both user→room pointers, returning true only if
   * the room hash actually existed (so exactly one racing caller "wins").
   */
  private async deleteRoom(roomId: string, userA: string, userB: string): Promise<boolean> {
    const result = (await this.redis.eval(
      DELETE_ROOM_LUA,
      3,
      roomKey(roomId),
      userRoomKey(userA),
      userRoomKey(userB),
    )) as number;
    return result === 1;
  }

  /** Build the over-the-wire {@link PeerInfo} for a waiter from their public profile. */
  private async buildPeerInfo(waiter: WaiterEntry): Promise<PeerInfo> {
    try {
      const profile = await this.profiles.getPublicProfile(waiter.userId);
      return {
        userId: profile.id,
        nickname: profile.nickname,
        age: profile.age,
        gender: profile.gender,
        country: profile.country,
        avatarUrl: profile.avatarUrl,
        badges: profile.badges,
        isPremium: profile.isPremium,
      };
    } catch (err) {
      // Fall back to the cached waiter facts if the profile read fails so the
      // call can still start with a minimal overlay.
      this.logger.debug(`buildPeerInfo fallback for ${waiter.userId}: ${asMessage(err)}`);
      return {
        userId: waiter.userId,
        nickname: '',
        age: waiter.age,
        gender: waiter.gender,
        country: waiter.country,
        avatarUrl: null,
        badges: [],
        isPremium: waiter.isPremium,
      };
    }
  }

  /** Premium check that never throws (treats failures as non-premium). */
  private async safeIsPremium(userId: string): Promise<boolean> {
    try {
      return await this.premium.isPremium(userId);
    } catch (err) {
      this.logger.debug(`isPremium failed for ${userId}: ${asMessage(err)}`);
      return false;
    }
  }

  /** Resolve a waiter's country from their public profile (best-effort). */
  private async resolveCountry(userId: string): Promise<string> {
    try {
      const profile = await this.profiles.getPublicProfile(userId);
      return profile.country;
    } catch {
      return '';
    }
  }
}

/**
 * Whether two waiters satisfy EACH OTHER's filters. Compatibility is symmetric:
 * each side's gender preference, age window and country list must accept the
 * other's demographics.
 */
export function areMutuallyCompatible(a: WaiterEntry, b: WaiterEntry): boolean {
  return satisfies(a.filters, b) && satisfies(b.filters, a);
}

/**
 * Count of interest tags two waiters have in common. Tags are stored normalised
 * (lowercased, deduped) so a plain set-membership intersection is exact and
 * case-insensitive. Returns 0 when either side has no interests — those users
 * still match (interests only prioritise) unless one side set
 * `sharedInterestsOnly`. Symmetric, side-effect free → ranks the scanned batch
 * and drives the `sharedInterestsOnly` gate.
 */
export function sharedInterestCount(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): number {
  if (!a?.length || !b?.length) {
    return 0;
  }
  const set = new Set(a);
  let count = 0;
  for (const tag of b) {
    if (set.has(tag)) {
      count += 1;
    }
  }
  return count;
}

/** Whether `other`'s demographics satisfy `filters`. */
function satisfies(filters: MatchFilters, other: Pick<WaiterEntry, 'age' | 'gender' | 'country'>): boolean {
  if (filters.gender !== 'any' && filters.gender !== other.gender) {
    return false;
  }
  if (other.age < filters.ageMin || other.age > filters.ageMax) {
    return false;
  }
  // Empty country list = no geographic restriction.
  if (filters.countries.length > 0 && !filters.countries.includes(other.country)) {
    return false;
  }
  return true;
}

/** Parse JSON, returning `null` instead of throwing on malformed input. */
function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Narrows an unknown thrown value to a printable message. */
function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Lua: claim a pair iff BOTH are still in the pool.
 * KEYS[1]=pool zset, KEYS[2]=waiter hash A, KEYS[3]=waiter hash B.
 * ARGV[1]=userA, ARGV[2]=userB (the ZSET members).
 *
 * Lua runs atomically, so we can safely TEST both memberships first and only
 * mutate when BOTH are present — no rollback needed. If either was already
 * claimed by a concurrent matcher we touch NOTHING (the survivor keeps its
 * original pool score / position) and return 0. On a clean claim we remove both
 * from the zset, delete both waiter hashes, and return 1.
 */
const CLAIM_PAIR_LUA = `
if redis.call('ZSCORE', KEYS[1], ARGV[1]) == false then return 0 end
if redis.call('ZSCORE', KEYS[1], ARGV[2]) == false then return 0 end
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[1], ARGV[2])
redis.call('DEL', KEYS[2])
redis.call('DEL', KEYS[3])
return 1
`;

/**
 * Lua: delete a room + both pointers atomically.
 * KEYS[1]=room hash, KEYS[2]=pointerA, KEYS[3]=pointerB. Returns 1 only if the
 * room existed (so exactly one racing teardown closes the durable match).
 */
const DELETE_ROOM_LUA = `
local existed = redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[2])
redis.call('DEL', KEYS[3])
if existed == 1 then return 1 end
return 0
`;
