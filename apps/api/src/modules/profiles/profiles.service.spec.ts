import type { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type { Connection, Model } from 'mongoose';
import { Types } from 'mongoose';

import type { ProfileSearchQuery } from '@ruletka/shared-types';

import type { BlocksService } from '../moderation/blocks.service';
import type { SettingsService } from '../settings/settings.service';
import { ProfilesService } from './profiles.service';
import type { ProfileDocument } from './schemas/profile.schema';

/**
 * These specs lock in the second-audit fix: profile SEARCH must apply the same
 * `whoCanViewProfile` gate as a direct profile read, so a `nobody`/`friends`
 * profile never leaks to a stranger through `/profiles/search`.
 */

const VIEWER_ID = '507f1f77bcf86cd799439011';
const EVERYONE_ID = '507f1f77bcf86cd799439021';
const NOBODY_ID = '507f1f77bcf86cd799439022';
const FRIENDS_ID = '507f1f77bcf86cd799439023';

/** Order-independent friendship pair key — mirrors the service's helper. */
function pairKey(a: string, b: string): string {
  const [first, second] = [a, b].sort();
  return `${first}:${second}`;
}

/** Minimal hydrated profile doc keyed by `userId`. */
function profileDoc(userId: string, nickname: string): ProfileDocument {
  return {
    _id: new Types.ObjectId(userId),
    userId: new Types.ObjectId(userId),
    nickname,
    avatarUrl: null,
    status: null,
    gender: 'male',
    birthDate: new Date('1990-01-01T00:00:00.000Z'),
    country: 'US',
    languages: [],
    interests: [],
    badges: [],
    isPremium: false,
    activeCover: undefined,
    profileViews: 0,
    get: (field: string) =>
      field === 'createdAt' ? new Date('2026-01-01T00:00:00.000Z') : undefined,
  } as unknown as ProfileDocument;
}

/** A chainable mongoose query stub whose `exec()` resolves to `rows`. */
function profileQuery(rows: ProfileDocument[]): Record<string, jest.Mock> {
  const q: Record<string, jest.Mock> = {};
  q.collation = jest.fn().mockReturnValue(q);
  q.sort = jest.fn().mockReturnValue(q);
  q.limit = jest.fn().mockReturnValue(q);
  q.exec = jest.fn().mockResolvedValue(rows);
  return q;
}

interface NativeCursor {
  toArray: jest.Mock;
}

/**
 * Build a `connection.collection(name)` mock where `settings`/`friendships`
 * `find(...).toArray()` return the supplied seed rows. `settingsRows` maps an
 * owner id → its `whoCanViewProfile`; `acceptedPairKeys` is the set of accepted
 * friendship pairKeys present for the viewer.
 */
function makeConnection(
  settingsByOwner: Record<string, string>,
  acceptedPairKeys: Set<string>,
): Connection {
  const settingsCursor: NativeCursor = {
    toArray: jest.fn().mockImplementation(() =>
      Object.entries(settingsByOwner).map(([ownerId, whoCanViewProfile]) => ({
        userId: new Types.ObjectId(ownerId),
        privacy: { whoCanViewProfile },
      })),
    ),
  };
  const friendshipsCursor: NativeCursor = {
    toArray: jest
      .fn()
      .mockImplementation(() => [...acceptedPairKeys].map((k) => ({ pairKey: k }))),
  };
  return {
    collection: jest.fn().mockImplementation((name: string) => {
      if (name === 'settings') {
        return { find: jest.fn().mockReturnValue(settingsCursor) };
      }
      if (name === 'friendships') {
        return { find: jest.fn().mockReturnValue(friendshipsCursor) };
      }
      throw new Error(`unexpected collection ${name}`);
    }),
  } as unknown as Connection;
}

describe('ProfilesService.searchProfiles — whoCanViewProfile gate', () => {
  const query: ProfileSearchQuery = { limit: 20 };

  function buildService(opts: {
    rows: ProfileDocument[];
    settingsByOwner: Record<string, string>;
    acceptedPairKeys?: Set<string>;
  }): ProfilesService {
    const profileModel = {
      find: jest.fn().mockReturnValue(profileQuery(opts.rows)),
    } as unknown as Model<ProfileDocument>;
    const settings = {} as unknown as SettingsService;
    const blocks = {
      listBlockedIds: jest.fn().mockResolvedValue([]),
    } as unknown as BlocksService;
    const connection = makeConnection(
      opts.settingsByOwner,
      opts.acceptedPairKeys ?? new Set<string>(),
    );
    return new ProfilesService(
      profileModel,
      connection,
      settings,
      blocks,
      {} as unknown as Redis,
      { get: jest.fn().mockReturnValue('') } as unknown as ConfigService,
    );
  }

  it('hides a "nobody" profile from a stranger', async () => {
    const service = buildService({
      rows: [profileDoc(EVERYONE_ID, 'everyone'), profileDoc(NOBODY_ID, 'nobody')],
      settingsByOwner: { [EVERYONE_ID]: 'everyone', [NOBODY_ID]: 'nobody' },
    });

    const result = await service.searchProfiles(VIEWER_ID, query);
    const ids = result.items.map((p) => p.id);

    expect(ids).toContain(EVERYONE_ID);
    expect(ids).not.toContain(NOBODY_ID);
  });

  it('shows a "friends" profile ONLY to an accepted friend', async () => {
    // Stranger: no accepted friendship → friends-only profile is filtered out.
    const stranger = buildService({
      rows: [profileDoc(FRIENDS_ID, 'friendsonly')],
      settingsByOwner: { [FRIENDS_ID]: 'friends' },
      acceptedPairKeys: new Set<string>(),
    });
    const strangerResult = await stranger.searchProfiles(VIEWER_ID, query);
    expect(strangerResult.items.map((p) => p.id)).not.toContain(FRIENDS_ID);

    // Accepted friend: the friendships `$in` finds the pairKey → profile appears.
    const friend = buildService({
      rows: [profileDoc(FRIENDS_ID, 'friendsonly')],
      settingsByOwner: { [FRIENDS_ID]: 'friends' },
      acceptedPairKeys: new Set<string>([pairKey(VIEWER_ID, FRIENDS_ID)]),
    });
    const friendResult = await friend.searchProfiles(VIEWER_ID, query);
    expect(friendResult.items.map((p) => p.id)).toContain(FRIENDS_ID);
  });

  it('treats an owner with NO settings doc as "everyone" (visible)', async () => {
    const service = buildService({
      rows: [profileDoc(EVERYONE_ID, 'nosettings')],
      // No settings rows at all — default visibility is everyone.
      settingsByOwner: {},
    });
    const result = await service.searchProfiles(VIEWER_ID, query);
    expect(result.items.map((p) => p.id)).toContain(EVERYONE_ID);
  });

  it('returns empty (no leak) for an invalid viewer id', async () => {
    const service = buildService({ rows: [], settingsByOwner: {} });
    const result = await service.searchProfiles('not-an-objectid', query);
    expect(result).toEqual({ items: [], nextCursor: null, hasMore: false });
  });
});
