import { ConflictException, NotFoundException } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import { REDIS_CLIENT } from '../../redis/redis.constants';
import { UsersService } from '../users/users.service';
import { BlocksService } from './blocks.service';
import { BLOCK_ENFORCE_CHANNEL } from './moderation.constants';
import { Block } from './schemas/block.schema';

const USER = '507f1f77bcf86cd799439011';
const TARGET = '507f1f77bcf86cd799439012';

/** Hydrated block stub the service maps via `toContract`. */
function blockDoc(): Record<string, unknown> {
  return {
    _id: { toString: () => 'block-1' },
    userId: { toString: () => USER },
    blockedUserId: { toString: () => TARGET },
    get: (_k: string) => new Date('2026-05-31T00:00:00.000Z'),
  };
}

describe('BlocksService — createBlock target validation', () => {
  let service: BlocksService;
  let blockModel: { create: jest.Mock };
  let usersService: { findById: jest.Mock };
  let redis: { publish: jest.Mock };

  beforeEach(async () => {
    blockModel = { create: jest.fn() };
    usersService = { findById: jest.fn() };
    redis = { publish: jest.fn().mockResolvedValue(1) };
    // createBlock never touches the Connection (only listOwnBlocks joins
    // profiles), so a bare collection stub satisfies DI here.
    const connection = { collection: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BlocksService,
        { provide: getModelToken(Block.name), useValue: blockModel },
        { provide: getConnectionToken(), useValue: connection },
        { provide: UsersService, useValue: usersService },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    service = moduleRef.get(BlocksService);
  });

  it('rejects a self-block before any DB work', async () => {
    await expect(service.createBlock(USER, { blockedUserId: USER })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(usersService.findById).not.toHaveBeenCalled();
    expect(blockModel.create).not.toHaveBeenCalled();
    // No block created → nothing to force-end.
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('404s when the blocked user does not exist', async () => {
    usersService.findById.mockResolvedValue(null);
    await expect(service.createBlock(USER, { blockedUserId: TARGET })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(blockModel.create).not.toHaveBeenCalled();
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('creates the block when the target exists', async () => {
    usersService.findById.mockResolvedValue({ _id: TARGET });
    blockModel.create.mockResolvedValue(blockDoc());

    const result = await service.createBlock(USER, { blockedUserId: TARGET });

    expect(blockModel.create).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('block-1');
    expect(result.blockedUserId).toBe(TARGET);
  });

  it('publishes a block-enforce message so any active call between the two is ended', async () => {
    usersService.findById.mockResolvedValue({ _id: TARGET });
    blockModel.create.mockResolvedValue(blockDoc());

    await service.createBlock(USER, { blockedUserId: TARGET });

    expect(redis.publish).toHaveBeenCalledTimes(1);
    const [channel, body] = redis.publish.mock.calls[0] as [string, string];
    expect(channel).toBe(BLOCK_ENFORCE_CHANNEL);
    expect(JSON.parse(body)).toEqual({ userId: USER, blockedUserId: TARGET });
  });

  it('still resolves the block if the enforce publish fails (best-effort)', async () => {
    usersService.findById.mockResolvedValue({ _id: TARGET });
    blockModel.create.mockResolvedValue(blockDoc());
    redis.publish.mockRejectedValue(new Error('redis down'));

    // A publish failure must NOT fail the block creation.
    const result = await service.createBlock(USER, { blockedUserId: TARGET });
    expect(result.id).toBe('block-1');
  });
});

describe('BlocksService — listOwnBlocks identity join', () => {
  let service: BlocksService;
  let blockModel: { find: jest.Mock };
  let profilesCollection: { find: jest.Mock };
  let connection: { collection: jest.Mock };

  /** A hydrated block row whose `blockedUserId` is a real-looking ObjectId. */
  function ownBlockRow(blockedHex: string): Record<string, unknown> {
    return {
      _id: { toString: () => `block-${blockedHex}` },
      userId: { toString: () => USER },
      blockedUserId: { toString: () => blockedHex },
      get: (_k: string) => new Date('2026-05-31T00:00:00.000Z'),
    };
  }

  beforeEach(async () => {
    blockModel = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([ownBlockRow(TARGET)]),
        }),
      }),
    };
    // The profiles collection is read via connection.collection('profiles').find(...).toArray().
    profilesCollection = {
      find: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { userId: { toString: () => TARGET }, nickname: 'NeonFox', avatarUrl: 'https://x/y.png' },
        ]),
      }),
    };
    connection = { collection: jest.fn().mockReturnValue(profilesCollection) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BlocksService,
        { provide: getModelToken(Block.name), useValue: blockModel },
        { provide: getConnectionToken(), useValue: connection },
        { provide: UsersService, useValue: { findById: jest.fn() } },
        { provide: REDIS_CLIENT, useValue: { publish: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(BlocksService);
  });

  it('enriches each block with the blocked user nickname + avatar (one batched $in)', async () => {
    const result = await service.listOwnBlocks(USER);

    expect(connection.collection).toHaveBeenCalledWith('profiles');
    // Single batched join, not an N+1.
    expect(profilesCollection.find).toHaveBeenCalledTimes(1);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      blockedUserId: TARGET,
      nickname: 'NeonFox',
      avatarUrl: 'https://x/y.png',
    });
  });

  it('falls back to empty nickname + null avatar when the profile is missing', async () => {
    // No profile row joined for the blocked user.
    profilesCollection.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });

    const result = await service.listOwnBlocks(USER);

    expect(result[0]).toMatchObject({
      blockedUserId: TARGET,
      nickname: '',
      avatarUrl: null,
    });
  });
});
