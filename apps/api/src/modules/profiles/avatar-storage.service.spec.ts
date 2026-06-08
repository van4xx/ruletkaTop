import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { AvatarStorageService, type UploadedAvatar } from './avatar-storage.service';

/**
 * A minimal valid PNG (1×1, transparent) — its magic bytes pass the service's
 * signature sniff so we exercise the post-validation normalise/store path. Tiny
 * on purpose: it is structurally a real PNG header, not just the 8-byte prefix,
 * so `sharp` (when present) can decode it.
 */
const ONE_PX_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Build a `ConfigService` stub returning the given env map by key. */
function configStub(env: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => env[key]),
  } as unknown as ConfigService;
}

/** Build the multer-shaped uploaded-file object the service consumes. */
function uploadOf(buffer: Buffer): UploadedAvatar {
  return {
    buffer,
    size: buffer.length,
    mimetype: 'image/png',
    originalname: 'avatar.png',
  };
}

describe('AvatarStorageService — sharp fail-closed in production', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ruletka-avatars-'));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  /** Construct a service whose `resolveSharp()` always reports sharp missing. */
  function serviceWithoutSharp(nodeEnv: string | undefined): AvatarStorageService {
    const service = new AvatarStorageService(
      configStub({ NODE_ENV: nodeEnv, UPLOADS_DIR: tmpRoot }),
    );
    // Force the "sharp native binary unavailable" branch deterministically,
    // regardless of whether the test host has sharp installed.
    (service as unknown as { sharp: false }).sharp = false;
    return service;
  }

  it('REJECTS the upload (never stores raw bytes) in production when sharp is missing', async () => {
    const service = serviceWithoutSharp('production');

    await expect(service.store('507f1f77bcf86cd799439011', uploadOf(ONE_PX_PNG))).rejects.toThrow(
      InternalServerErrorException,
    );

    // Nothing must have been written: a raw, un-re-encoded upload would leak
    // EXIF/GPS and could serve a decode-bomb at full size.
    const avatarsDir = path.join(tmpRoot, 'avatars');
    const written = await fs.readdir(avatarsDir).catch(() => [] as string[]);
    expect(written).toHaveLength(0);
  });

  it('stores the validated bytes (store-as-is fallback) in NON-production when sharp is missing', async () => {
    const service = serviceWithoutSharp('development');

    const stored = await service.store('507f1f77bcf86cd799439011', uploadOf(ONE_PX_PNG));

    expect(stored.url).toMatch(/^\/uploads\/avatars\/.+\.png$/);
    const bytes = await fs.readFile(stored.absolutePath);
    // The dev fallback persists the original magic-byte-validated PNG as-is.
    expect(bytes.equals(ONE_PX_PNG)).toBe(true);
  });

  it('still rejects non-image bytes up-front in production (before the sharp gate)', async () => {
    const service = serviceWithoutSharp('production');
    await expect(
      service.store('507f1f77bcf86cd799439011', uploadOf(Buffer.from('not an image'))),
    ).rejects.toThrow(BadRequestException);
  });
});
