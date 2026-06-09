import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Redis } from 'ioredis';
import { ClientSession, Connection, Model, type QueryFilter, Types } from 'mongoose';

import { REDIS_CLIENT } from '../../redis/redis.constants';

import type {
  CoverId,
  Gender,
  GiftTransaction,
  ProfileSearchQuery,
  PublicProfile,
  UpdateProfileDto,
} from '@ruletka/shared-types';
import { DEFAULT_COVER_ID } from '@ruletka/shared-types';

import { BlocksService } from '../moderation/blocks.service';
import { SettingsService } from '../settings/settings.service';
import { Profile, ProfileDocument } from './schemas/profile.schema';

/**
 * Order-independent friendship pair key, `"<minId>:<maxId>"` by hex comparison.
 * Mirrors `buildPairKey` in the friends module; replicated here (a couple of
 * lines) so profile-visibility gating can probe the `friendships` collection
 * directly WITHOUT importing FriendsModule — that would form a dependency cycle
 * (FriendsModule already imports ProfilesModule).
 */
function friendshipPairKey(a: string, b: string): string {
  const [first, second] = [a, b].sort();
  return `${first}:${second}`;
}

/** Escape regex metacharacters so user input is matched literally (no ReDoS). */
function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Minimum age (years) required to hold a profile. */
const MIN_AGE_YEARS = 18;

/** Max interest tags stored per profile (mirrors `updateProfileSchema`'s `.max(10)`). */
const MAX_INTERESTS = 10;

/**
 * Canonicalise interest tags for storage + matching: trim, lowercase, drop
 * empties, dedupe (case-insensitively, first-seen order) and cap at
 * {@link MAX_INTERESTS}. Lowercasing makes shared-interest comparison
 * case-insensitive across profiles ("Music" and "music" match). Zod has already
 * bounded each tag to ≤24 chars; this is the persistence-layer normalisation so
 * the stored set is always clean regardless of caller.
 */
export function normaliseInterests(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of raw) {
    const norm = tag.trim().toLowerCase();
    if (norm.length === 0 || seen.has(norm)) {
      continue;
    }
    seen.add(norm);
    out.push(norm);
    if (out.length >= MAX_INTERESTS) {
      break;
    }
  }
  return out;
}

/**
 * Window (seconds) during which repeated views of the same profile by the same
 * viewer are NOT re-counted. Stops a single viewer (or a refresh loop) from
 * inflating another user's lifetime view counter.
 */
const VIEW_THROTTLE_TTL_SECONDS = 60 * 60; // 1 hour

/** MongoDB duplicate-key error code. */
const DUPLICATE_KEY_CODE = 11000;

/** Type guard for a MongoDB duplicate-key write error. */
function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: number }).code === DUPLICATE_KEY_CODE
  );
}

/** Fields the profile owner may patch (mirrors `updateProfileSchema`). */
type ProfileMutableFields = Partial<{
  nickname: string;
  status: string;
  gender: Gender;
  birthDate: Date;
  country: string;
  languages: PublicProfile['languages'];
  interests: string[];
}>;

/** A page of public profiles (newest-first) with an opaque cursor. */
export interface ProfileSearchResult {
  items: PublicProfile[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Public-facing received-gift row. Identical to {@link GiftTransaction} EXCEPT
 * the sender (`fromUserId`) is intentionally DROPPED: the received-gift wall is
 * a public/visibility-gated read, and exposing every sender's id leaks who
 * gifted whom (a privacy + soft-deanonymisation issue) even from a "friends-only"
 * or "nobody" profile. The wall only ever needs the gift glyph + value, never
 * the sender, so we never put `fromUserId` on the wire here.
 */
export type PublicGiftTransaction = Omit<GiftTransaction, 'fromUserId'>;

/** Input accepted by {@link ProfilesService.createProfile}. */
export interface CreateProfileInput {
  userId: string;
  nickname: string;
  gender: Gender;
  birthDate: Date;
  country: string;
  languages?: PublicProfile['languages'];
  interests?: string[];
}

/**
 * Whole-second age in years from a date of birth, relative to `now`.
 * Used both to enforce the 18+ rule and to expose `age` on public profiles.
 */
export function computeAge(birthDate: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - birthDate.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < birthDate.getUTCDate())) {
    age -= 1;
  }
  return age;
}

/**
 * Owns the `profiles` collection and the read model exposed cross-module.
 *
 * Exported methods consumed by other groups: {@link getPublicProfile},
 * {@link incrementViews}, {@link getAgeAndGender}. Registration (auth) uses
 * {@link createProfile} inside the same transaction that creates the `User`.
 */
@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);

  /**
   * Externally-reachable base origin the avatar files are served from (e.g.
   * `http://localhost:4000` in dev; in prod the host nginx serves `/uploads`
   * from). Read once from `PUBLIC_API_URL`; empty means "emit the stored value
   * verbatim" (relative paths stay relative). Trailing slash trimmed.
   */
  private readonly publicApiBase: string;

  constructor(
    @InjectModel(Profile.name) private readonly profileModel: Model<ProfileDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly settingsService: SettingsService,
    private readonly blocksService: BlocksService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    this.publicApiBase = (this.config.get<string>('PUBLIC_API_URL') ?? '').replace(/\/+$/, '');
  }

  /**
   * Project a STORED avatar reference onto the wire. Stored values are either:
   *   - a server-relative `/uploads/...` path (what the upload endpoint writes) —
   *     prefixed with {@link publicApiBase} so cross-origin clients (the web app
   *     on another origin, mobile) can load it directly; or
   *   - a legacy absolute `http(s)://…` URL — returned unchanged.
   * `null` (no avatar) passes through as `null`. When `PUBLIC_API_URL` is unset
   * the relative path is returned as-is (same-origin / nginx-rewrite setups).
   */
  private resolveAvatarUrl(stored: string | null): string | null {
    if (!stored) return null;
    if (/^https?:\/\//i.test(stored)) return stored;
    if (stored.startsWith('/uploads/') && this.publicApiBase) {
      return `${this.publicApiBase}${stored}`;
    }
    return stored;
  }

  /** Create a profile (optionally enlisted in a registration transaction). */
  async createProfile(
    input: CreateProfileInput,
    session?: ClientSession,
  ): Promise<ProfileDocument> {
    if (computeAge(input.birthDate) < MIN_AGE_YEARS) {
      throw new BadRequestException('Must be at least 18 years old');
    }
    try {
      const docs: ProfileDocument[] = await this.profileModel.create(
        [
          {
            userId: new Types.ObjectId(input.userId),
            nickname: input.nickname,
            gender: input.gender,
            birthDate: input.birthDate,
            country: input.country,
            languages: input.languages ?? [],
            interests: normaliseInterests(input.interests ?? []),
            badges: [],
            isPremium: false,
            premiumUntil: null,
            activeCover: DEFAULT_COVER_ID,
            ownedCovers: [],
            profileViews: 0,
            avatarUrl: null,
            status: null,
          },
        ],
        session ? { session } : {},
      );
      const created = docs[0];
      if (!created) {
        throw new Error('Profile creation returned no document');
      }
      return created;
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ConflictException('Nickname already taken');
      }
      throw err;
    }
  }

  /** Raw profile document by owning user id, or `null`. */
  async findByUserId(userId: string): Promise<ProfileDocument | null> {
    if (!Types.ObjectId.isValid(userId)) {
      return null;
    }
    return this.profileModel.findOne({ userId: new Types.ObjectId(userId) }).exec();
  }

  /**
   * RAW public profile projection (the `publicProfileSchema` shape) for a user,
   * or `404` if absent. This performs NO visibility gating and is for trusted
   * INTERNAL cross-module callers (e.g. friend-summary composition, where
   * access is already established). HTTP callers must use
   * {@link getPublicProfileFor}, which enforces `whoCanViewProfile`.
   */
  async getPublicProfile(userId: string): Promise<PublicProfile> {
    const doc = await this.findByUserId(userId);
    if (!doc) {
      throw new NotFoundException('Profile not found');
    }
    return this.toPublicProfile(doc);
  }

  /**
   * Visibility-gated public profile for `viewerId` looking at `targetId`,
   * enforcing the target's `whoCanViewProfile` privacy setting:
   *
   *   - owner viewing their own profile → always allowed;
   *   - `everyone` → public (incl. anonymous viewers);
   *   - `friends`  → requires an ACCEPTED friendship with the viewer (a
   *                  signed-out viewer is never a friend);
   *   - `nobody`   → hidden from everyone but the owner.
   *
   * A blocked relationship (either direction) also hides the profile. To avoid
   * leaking existence, a denied view throws the SAME `404 Not Found` as a
   * missing profile rather than a `403`.
   */
  async getPublicProfileFor(viewerId: string | null, targetId: string): Promise<PublicProfile> {
    const doc = await this.findByUserId(targetId);
    if (!doc) {
      throw new NotFoundException('Profile not found');
    }
    const ownerId = doc.userId.toString();

    // Owner always sees their own profile, ungated.
    if (viewerId && viewerId === ownerId) {
      return this.toPublicProfile(doc);
    }

    // A block in either direction hides the profile entirely.
    if (viewerId && (await this.blocksService.isBlocked(viewerId, ownerId))) {
      throw new NotFoundException('Profile not found');
    }

    const visibility = await this.settingsService.getProfileVisibility(ownerId);
    if (visibility === 'everyone') {
      return this.toPublicProfile(doc);
    }
    if (visibility === 'friends') {
      if (viewerId && (await this.areAcceptedFriends(viewerId, ownerId))) {
        return this.toPublicProfile(doc);
      }
      throw new NotFoundException('Profile not found');
    }
    // 'nobody' — only the owner (handled above) may view.
    throw new NotFoundException('Profile not found');
  }

  /**
   * Search profiles by optional nickname prefix + gender/country facets,
   * cursor-paginated by `_id`. Always EXCLUDES the caller and anyone in a block
   * relationship with them (either direction).
   *
   * VISIBILITY-GATED: results are filtered by each owner's `whoCanViewProfile`
   * EXACTLY as {@link getPublicProfileFor} would, so search never leaks a
   * `friends`/`nobody` profile to a stranger (the audit found search bypassed
   * the gate entirely). The gate is applied in BATCH so a page stays a couple of
   * round-trips rather than O(page) reads:
   *   - one `$in` over `settings` reads every page owner's `whoCanViewProfile`;
   *   - `everyone` (and owners with NO settings doc — the default is `everyone`)
   *     stay visible; `nobody` is always dropped;
   *   - `friends`-only owners survive only when a single `$in` over `friendships`
   *     (by {@link friendshipPairKey}, `status: 'accepted'`) confirms an accepted
   *     friendship with the viewer.
   * We OVER-FETCH and refill so a full page is still returned after filtering;
   * the cursor advances by the last RAW row scanned (not the last visible one)
   * so the next page resumes correctly even across dropped rows.
   */
  async searchProfiles(viewerId: string, query: ProfileSearchQuery): Promise<ProfileSearchResult> {
    if (!Types.ObjectId.isValid(viewerId)) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const blockedIds = await this.blocksService.listBlockedIds(viewerId);
    const excludedObjectIds = [viewerId, ...blockedIds]
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));

    const baseFilter: QueryFilter<ProfileDocument> = {
      userId: { $nin: excludedObjectIds },
    };
    if (query.gender) {
      baseFilter.gender = query.gender;
    }
    if (query.country) {
      baseFilter.country = query.country;
    }
    if (query.q) {
      // Anchored, escaped nickname PREFIX match (no ReDoS, no contains-scan).
      // NOTE: no `i` flag — case-insensitivity comes from the query COLLATION
      // (`strength: 2`) below, which lets the match use the `nickname_ci`
      // collation index as an indexed RANGE scan. A regex with `$options: 'i'`
      // would instead force a full `_id` index scan + per-doc filter (the
      // planner cannot use a binary nickname index for a case-insensitive
      // regex). The charset is `[a-zA-Z0-9_]`, so collation case-folding yields
      // results identical to the previous `/i` match.
      baseFilter.nickname = { $regex: `^${escapeRegExp(query.q)}` };
    }

    // Over-fetch and refill: dropping `nobody`/non-friend `friends` profiles
    // would otherwise hand back a short page. We scan in batches of `limit*2+1`
    // from the cursor, visibility-filter each batch, and keep going until we have
    // `limit+1` visible rows (the +1 detects `hasMore`) or the source is
    // exhausted. The loop is bounded so a viewer surrounded by hidden profiles
    // cannot make this scan unboundedly — it stops after a few batches and simply
    // returns whatever it found (with a cursor to continue).
    const visible: ProfileDocument[] = [];
    let cursor = query.cursor && Types.ObjectId.isValid(query.cursor) ? query.cursor : null;
    let rawHasMore = false;
    let lastScannedId: string | null = null;
    const batchSize = query.limit * 2 + 1;
    const MAX_BATCHES = 5;

    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const filter: QueryFilter<ProfileDocument> = { ...baseFilter };
      // Cursor pagination on the monotonic `_id` (descending = newest first).
      if (cursor) {
        filter._id = { $lt: new Types.ObjectId(cursor) };
      }

      // The collation MUST match the `nickname_ci` index definition for the
      // prefix query to be served by it; `_id` sort/cursor bounds are binary
      // ObjectIds and are unaffected by the collation.
      const rows = await this.profileModel
        .find(filter)
        .collation({ locale: 'en', strength: 2 })
        .sort({ _id: -1 })
        .limit(batchSize)
        .exec();

      rawHasMore = rows.length === batchSize;
      if (rows.length > 0) {
        const last = rows[rows.length - 1];
        if (last) {
          lastScannedId = last._id.toString();
          cursor = lastScannedId;
        }
      }

      const visibleRows = await this.filterVisible(viewerId, rows);
      visible.push(...visibleRows);

      // Stop once we can fill a page (+1 to know there's a next page) or the
      // underlying source has no more rows to scan.
      if (visible.length > query.limit || !rawHasMore) {
        break;
      }
    }

    const hasMore = visible.length > query.limit || rawHasMore;
    const page = visible.slice(0, query.limit);
    // The cursor advances by the last RAW row scanned so the next page resumes
    // immediately AFTER everything we already examined (visible or filtered-out),
    // never re-scanning dropped rows. Only emit a cursor when more may follow.
    const nextCursor = hasMore && lastScannedId ? lastScannedId : null;

    return {
      items: page.map((doc) => this.toPublicProfile(doc)),
      nextCursor,
      hasMore,
    };
  }

  /**
   * Filter a batch of profile docs down to those the `viewerId` may see under
   * each owner's `whoCanViewProfile`, mirroring {@link getPublicProfileFor} but
   * in BATCH (two `$in` reads for the whole batch, not per-row):
   *   - the viewer always sees THEMSELVES (defensive — search already excludes
   *     the caller, but this keeps the gate self-consistent);
   *   - `everyone`, or NO settings doc (default visibility is `everyone`) → visible;
   *   - `nobody` → always dropped;
   *   - `friends` → visible only with an ACCEPTED friendship to the viewer.
   * Input order is preserved. Reads the `settings` and `friendships` collections
   * directly by name (no extra model / module dependency).
   */
  private async filterVisible(
    viewerId: string,
    rows: ProfileDocument[],
  ): Promise<ProfileDocument[]> {
    if (rows.length === 0) {
      return [];
    }

    const ownerObjectIds = rows.map((doc) => doc.userId);

    // One read: every owner's whoCanViewProfile (absent doc ⇒ default 'everyone').
    const settingsRows = await this.connection
      .collection('settings')
      .find(
        { userId: { $in: ownerObjectIds } },
        { projection: { userId: 1, 'privacy.whoCanViewProfile': 1 } },
      )
      .toArray();
    const visibilityByOwner = new Map<string, string>();
    for (const row of settingsRows) {
      const ownerId = (row.userId as Types.ObjectId | undefined)?.toString();
      const privacy = row.privacy as { whoCanViewProfile?: string } | undefined;
      if (ownerId && privacy?.whoCanViewProfile) {
        visibilityByOwner.set(ownerId, privacy.whoCanViewProfile);
      }
    }

    // Owners whose visibility is `friends` need an accepted-friendship check.
    // Resolve all of them in ONE `$in` over friendships by pairKey.
    const friendCandidates = rows
      .map((doc) => doc.userId.toString())
      .filter((ownerId) => (visibilityByOwner.get(ownerId) ?? 'everyone') === 'friends');
    const acceptedFriendOwners = new Set<string>();
    if (friendCandidates.length > 0) {
      const pairKeyToOwner = new Map<string, string>();
      for (const ownerId of friendCandidates) {
        // viewer === owner is impossible here (caller is excluded from search),
        // but friendshipPairKey is order-independent regardless.
        pairKeyToOwner.set(friendshipPairKey(viewerId, ownerId), ownerId);
      }
      const friendships = await this.connection
        .collection('friendships')
        .find(
          { pairKey: { $in: [...pairKeyToOwner.keys()] }, status: 'accepted' },
          { projection: { pairKey: 1 } },
        )
        .toArray();
      for (const f of friendships) {
        const owner = pairKeyToOwner.get(String(f.pairKey));
        if (owner) {
          acceptedFriendOwners.add(owner);
        }
      }
    }

    return rows.filter((doc) => {
      const ownerId = doc.userId.toString();
      if (ownerId === viewerId) {
        return true;
      }
      const visibility = visibilityByOwner.get(ownerId) ?? 'everyone';
      if (visibility === 'everyone') {
        return true;
      }
      if (visibility === 'friends') {
        return acceptedFriendOwners.has(ownerId);
      }
      // 'nobody' (or any unknown value) → hidden.
      return false;
    });
  }

  /**
   * Whether `a` and `b` have an ACCEPTED friendship. Reads the `friendships`
   * collection directly by name (rather than importing FriendsService) to keep
   * the module graph acyclic — see {@link friendshipPairKey}.
   */
  private async areAcceptedFriends(a: string, b: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(a) || !Types.ObjectId.isValid(b) || a === b) {
      return false;
    }
    const row = await this.connection
      .collection('friendships')
      .findOne({ pairKey: friendshipPairKey(a, b), status: 'accepted' });
    return row !== null;
  }

  /**
   * Atomically increment the lifetime view counter for a profile. No-op-safe:
   * a missing profile simply matches nothing.
   */
  async incrementViews(userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      return;
    }
    await this.profileModel
      .updateOne({ userId: new Types.ObjectId(userId) }, { $inc: { profileViews: 1 } })
      .exec();
  }

  /**
   * Throttled view count: increment `profileId`'s lifetime views AT MOST once
   * per {@link VIEW_THROTTLE_TTL_SECONDS} per distinct `viewerKey` (a viewer id,
   * or an anonymous fingerprint such as the client IP). Backed by a Redis
   * `SET key 1 NX EX <ttl>` — the increment runs only when the key did not yet
   * exist. If Redis is unavailable we fail OPEN (count the view) so analytics
   * degrade gracefully rather than block the request.
   */
  async recordView(profileId: string, viewerKey: string): Promise<void> {
    if (!Types.ObjectId.isValid(profileId)) {
      return;
    }
    let shouldCount = true;
    try {
      const key = `profileview:${profileId}:${viewerKey}`;
      const set = await this.redis.set(key, '1', 'EX', VIEW_THROTTLE_TTL_SECONDS, 'NX');
      // `set` is 'OK' on first write within the window, null if the key existed.
      shouldCount = set === 'OK';
    } catch (err) {
      this.logger.warn(`View throttle Redis error (counting anyway): ${(err as Error).message}`);
      shouldCount = true;
    }
    if (shouldCount) {
      await this.incrementViews(profileId);
    }
  }

  /**
   * Lightweight `{ age, gender, country, interests }` lookup used by matchmaking
   * when enqueuing a waiter (cheaper than a full public-profile build, and a
   * SINGLE profile read — the country is returned here so the enqueue path no
   * longer needs a second `getPublicProfile` round-trip just for it). `interests`
   * is already normalised at write time; both `interests` and `country` default
   * to their empty value for profiles that predate the field. Throws `404` if the
   * profile does not exist.
   */
  async getAgeAndGender(
    userId: string,
  ): Promise<{ age: number; gender: Gender; country: string; interests: string[] }> {
    const doc = await this.findByUserId(userId);
    if (!doc) {
      throw new NotFoundException('Profile not found');
    }
    return {
      age: computeAge(doc.birthDate),
      gender: doc.gender,
      country: doc.country ?? '',
      interests: doc.interests ?? [],
    };
  }

  /**
   * Apply an owner's partial update. Validates 18+ when `birthDate` changes and
   * surfaces a duplicate `nickname` as a `409`-style conflict via the unique
   * index (translated by the caller/global filter). Returns the updated public
   * profile.
   */
  async updateOwnProfile(userId: string, patch: UpdateProfileDto): Promise<PublicProfile> {
    const update: ProfileMutableFields = {};
    if (patch.nickname !== undefined) update.nickname = patch.nickname;
    if (patch.status !== undefined) update.status = patch.status;
    // `avatarUrl` is intentionally NOT patchable here — the avatar is owned by
    // the dedicated upload endpoints (see `setAvatar` / `clearAvatar`).
    if (patch.gender !== undefined) update.gender = patch.gender;
    if (patch.country !== undefined) update.country = patch.country;
    if (patch.languages !== undefined) update.languages = patch.languages;
    if (patch.interests !== undefined) {
      update.interests = normaliseInterests(patch.interests);
    }
    if (patch.birthDate !== undefined) {
      const birthDate = new Date(patch.birthDate);
      if (Number.isNaN(birthDate.getTime())) {
        throw new BadRequestException('Invalid birthDate');
      }
      if (computeAge(birthDate) < MIN_AGE_YEARS) {
        throw new BadRequestException('Must be at least 18 years old');
      }
      update.birthDate = birthDate;
    }

    let doc: ProfileDocument | null;
    try {
      doc = await this.profileModel
        .findOneAndUpdate(
          { userId: new Types.ObjectId(userId) },
          { $set: update },
          {
            new: true,
            runValidators: true,
          },
        )
        .exec();
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ConflictException('Nickname already taken');
      }
      throw err;
    }
    if (!doc) {
      throw new NotFoundException('Profile not found');
    }
    return this.toPublicProfile(doc);
  }

  /**
   * Read ONLY the currently-stored `avatarUrl` for a user (or `null` when the
   * profile is missing or has no avatar). Used by the avatar-upload flow to
   * locate the file that the new upload supersedes, so it can be deleted.
   */
  async getAvatarUrl(userId: string): Promise<string | null> {
    const doc = await this.findByUserId(userId);
    return doc?.avatarUrl ?? null;
  }

  /**
   * Point the caller's avatar at a freshly-stored file path and return the
   * updated public profile. The path is produced + validated by the avatar
   * upload pipeline (a server-generated, re-encoded local file under
   * `/uploads/avatars/`); this method only persists it. Use {@link clearAvatar}
   * to reset to the default.
   */
  async setAvatar(userId: string, avatarUrl: string): Promise<PublicProfile> {
    const doc = await this.profileModel
      .findOneAndUpdate(
        { userId: new Types.ObjectId(userId) },
        { $set: { avatarUrl } },
        { new: true, runValidators: true },
      )
      .exec();
    if (!doc) {
      throw new NotFoundException('Profile not found');
    }
    return this.toPublicProfile(doc);
  }

  /**
   * Reset the caller's avatar to the default (clear the stored path). Returns
   * the updated public profile. Deletion of the underlying file is handled by
   * the controller/storage layer; this only nulls the persisted reference.
   */
  async clearAvatar(userId: string): Promise<PublicProfile> {
    const doc = await this.profileModel
      .findOneAndUpdate(
        { userId: new Types.ObjectId(userId) },
        { $set: { avatarUrl: null } },
        { new: true, runValidators: true },
      )
      .exec();
    if (!doc) {
      throw new NotFoundException('Profile not found');
    }
    return this.toPublicProfile(doc);
  }

  /**
   * Gifts received by a user, newest first — VISIBILITY-GATED for `viewerId`.
   *
   * The received-gift wall is part of the public profile, so it MUST honour the
   * target's `whoCanViewProfile` exactly like {@link getPublicProfileFor}: we
   * resolve the profile through that same gate first, so a stranger viewing a
   * `friends`/`nobody` profile (or one in a block relationship) gets the SAME
   * `404 Not Found` as the profile read — never the gift list. The sender id is
   * additionally dropped from every row (see {@link PublicGiftTransaction}).
   *
   * Reads the economy-owned `gifttransactions` collection directly by name (no
   * duplicate model) so the profiles module does not take a hard schema
   * dependency on economy.
   */
  async getReceivedGifts(
    viewerId: string | null,
    userId: string,
    limit = 50,
  ): Promise<PublicGiftTransaction[]> {
    if (!Types.ObjectId.isValid(userId)) {
      return [];
    }
    // Enforce the SAME privacy gate as the profile read. Throws `404` (matching
    // the sibling profile endpoint) when the viewer may not see this profile,
    // so a friends-only / nobody profile never leaks its gift wall + senders.
    await this.getPublicProfileFor(viewerId, userId);

    const rows = await this.connection
      .collection('gifttransactions')
      .find({ toUserId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return rows.map((row) => this.toPublicGiftTransaction(row));
  }

  /** Map a hydrated profile to the public over-the-wire shape. */
  private toPublicProfile(doc: ProfileDocument): PublicProfile {
    return {
      id: doc.userId.toString(),
      nickname: doc.nickname,
      avatarUrl: this.resolveAvatarUrl(doc.avatarUrl),
      status: doc.status,
      gender: doc.gender,
      age: computeAge(doc.birthDate),
      // Country is optional on the profile now; surface "" (no region) when
      // unset so the wire shape stays a plain string and clients keep rendering
      // a neutral fallback (🌍) rather than choking on null.
      country: doc.country ?? '',
      languages: doc.languages,
      // Existing profiles predating the field have no `interests` → default to []
      // so the response always satisfies `publicProfileSchema`.
      interests: doc.interests ?? [],
      badges: doc.badges,
      isPremium: doc.isPremium,
      // Profiles predating the field fall back to the default free cover so the
      // response always satisfies `publicProfileSchema`.
      activeCover: (doc.activeCover as CoverId | undefined) ?? DEFAULT_COVER_ID,
      profileViews: doc.profileViews,
      createdAt: doc.get('createdAt').toISOString(),
    };
  }

  /**
   * Map a raw `gifttransactions` row to the PUBLIC received-gift shape. The
   * sender (`fromUserId`) is deliberately OMITTED — see
   * {@link PublicGiftTransaction}; the wall renders only the gift + value.
   */
  private toPublicGiftTransaction(row: Record<string, unknown>): PublicGiftTransaction {
    const createdAt = row.createdAt;
    return {
      id: String(row._id),
      toUserId: String(row.toUserId),
      giftId: String(row.giftId),
      priceCoins: Number(row.priceCoins ?? 0),
      context: (row.context as GiftTransaction['context']) ?? 'profile',
      createdAt: createdAt instanceof Date ? createdAt.toISOString() : String(createdAt ?? ''),
    };
  }
}
