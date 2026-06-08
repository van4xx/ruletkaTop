import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type { Connection, Model } from 'mongoose';

import type { BlocksService } from '../moderation/blocks.service';
import type { SettingsService } from '../settings/settings.service';
import { ProfilesService } from './profiles.service';
import type { ProfileDocument } from './schemas/profile.schema';

const OWNER_ID = '507f1f77bcf86cd799439011';
const STRANGER_ID = '507f1f77bcf86cd799439012';

/** A `findOne(...).exec()` query stub resolving to `doc`. */
function findOneReturning(doc: unknown): { exec: jest.Mock } {
  return { exec: jest.fn().mockResolvedValue(doc) };
}

/** Minimal hydrated profile doc for `findByUserId` / `toPublicProfile`. */
function profileDoc(userId: string): ProfileDocument {
  return {
    userId: { toString: () => userId },
    nickname: 'owner',
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

/** A raw `gifttransactions` row (as Mongo's native driver returns it). */
function giftRow(): Record<string, unknown> {
  return {
    _id: 'gift-1',
    fromUserId: { toString: () => STRANGER_ID },
    toUserId: { toString: () => OWNER_ID },
    giftId: { toString: () => 'gift-def-1' },
    priceCoins: 100,
    context: 'profile',
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
  };
}

describe('ProfilesService.getReceivedGifts — privacy gate + sender omission', () => {
  let service: ProfilesService;
  let profileModel: { findOne: jest.Mock };
  let settings: { getProfileVisibility: jest.Mock };
  let blocks: { isBlocked: jest.Mock; listBlockedIds: jest.Mock };
  let giftCursor: { find: jest.Mock; sort: jest.Mock; limit: jest.Mock; toArray: jest.Mock };
  let connection: Connection;

  beforeEach(() => {
    profileModel = {
      findOne: jest.fn().mockReturnValue(findOneReturning(profileDoc(OWNER_ID))),
    };
    settings = { getProfileVisibility: jest.fn().mockResolvedValue('everyone') };
    blocks = {
      isBlocked: jest.fn().mockResolvedValue(false),
      listBlockedIds: jest.fn().mockResolvedValue([]),
    };

    // `connection.collection('gifttransactions').find().sort().limit().toArray()`
    giftCursor = {
      find: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([giftRow()]),
    };
    connection = {
      collection: jest.fn().mockReturnValue(giftCursor),
    } as unknown as Connection;

    service = new ProfilesService(
      profileModel as unknown as Model<ProfileDocument>,
      connection,
      settings as unknown as SettingsService,
      blocks as unknown as BlocksService,
      {} as unknown as Redis,
      { get: jest.fn().mockReturnValue('') } as unknown as ConfigService,
    );
  });

  it('returns the gift wall to a stranger for an "everyone" profile, WITHOUT fromUserId', async () => {
    const gifts = await service.getReceivedGifts(STRANGER_ID, OWNER_ID);
    expect(gifts).toHaveLength(1);
    // Sender id is dropped from the public projection.
    expect(gifts[0]).not.toHaveProperty('fromUserId');
    expect(gifts[0]).toMatchObject({ id: 'gift-1', toUserId: OWNER_ID, giftId: 'gift-def-1' });
  });

  it('404s for a STRANGER when the profile is friends-only (no leak of the gift wall)', async () => {
    settings.getProfileVisibility.mockResolvedValue('friends');
    // No accepted friendship → `areAcceptedFriends` reads friendships and finds none.
    (connection.collection as jest.Mock).mockImplementation((name: string) =>
      name === 'friendships'
        ? { findOne: jest.fn().mockResolvedValue(null) }
        : giftCursor,
    );

    await expect(service.getReceivedGifts(STRANGER_ID, OWNER_ID)).rejects.toThrow(
      NotFoundException,
    );
    // The gift collection must never have been queried.
    expect(giftCursor.toArray).not.toHaveBeenCalled();
  });

  it('404s for an ANONYMOUS viewer when the profile is "nobody"', async () => {
    settings.getProfileVisibility.mockResolvedValue('nobody');
    await expect(service.getReceivedGifts(null, OWNER_ID)).rejects.toThrow(NotFoundException);
    expect(giftCursor.toArray).not.toHaveBeenCalled();
  });

  it('lets the OWNER see their own gift wall regardless of visibility', async () => {
    settings.getProfileVisibility.mockResolvedValue('nobody');
    const gifts = await service.getReceivedGifts(OWNER_ID, OWNER_ID);
    expect(gifts).toHaveLength(1);
    expect(gifts[0]).not.toHaveProperty('fromUserId');
  });
});
