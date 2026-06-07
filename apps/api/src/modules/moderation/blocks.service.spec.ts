import { ConflictException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
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

    const moduleRef = await Test.createTestingModule({
      providers: [
        BlocksService,
        { provide: getModelToken(Block.name), useValue: blockModel },
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
