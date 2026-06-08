import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Maximum accepted upload size in bytes (~5 MB). Mirrored in shared-types
 * (`AVATAR_MAX_BYTES`) and enforced first by multer's `limits.fileSize`; this is
 * the defence-in-depth re-check on the buffer that actually arrived.
 */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/** The square edge (px) every avatar is normalised to. */
const AVATAR_EDGE_PX = 512;

/** Public URL path prefix the saved files are served under (see main.ts static-assets). */
const AVATAR_URL_PREFIX = '/uploads/avatars';

/** On-disk subfolder (under the uploads root) that holds avatar files. */
const AVATAR_SUBDIR = 'avatars';

/**
 * Magic-byte signatures for the image types we accept. We NEVER trust the
 * client-supplied mimetype/extension — the bytes themselves must start with one
 * of these prefixes (with a small structural check for WEBP/GIF). A file whose
 * content does not match is rejected even if it was uploaded as `image/png`.
 */
interface ImageSignature {
  readonly ext: 'jpg' | 'png' | 'webp' | 'gif';
  /** Returns true when `buf` begins with this format's magic bytes. */
  readonly matches: (buf: Buffer) => boolean;
}

const IMAGE_SIGNATURES: readonly ImageSignature[] = [
  {
    ext: 'jpg',
    // JPEG: FF D8 FF
    matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: 'png',
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    matches: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    ext: 'gif',
    // GIF: "GIF87a" or "GIF89a"
    matches: (b) =>
      b.length >= 6 &&
      b.toString('ascii', 0, 3) === 'GIF' &&
      (b.toString('ascii', 3, 6) === '87a' || b.toString('ascii', 3, 6) === '89a'),
  },
  {
    ext: 'webp',
    // WEBP: "RIFF" .... "WEBP"
    matches: (b) =>
      b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
];

/** Minimal shape of the multer-uploaded file we consume (in-memory buffer). */
export interface UploadedAvatar {
  buffer: Buffer;
  size: number;
  mimetype: string;
  originalname: string;
}

/** Result of persisting an avatar: the served URL path + the absolute disk path. */
export interface StoredAvatar {
  /** Server-relative URL the client renders, e.g. `/uploads/avatars/<id>-<hash>.webp`. */
  url: string;
  /** Absolute filesystem path of the written file. */
  absolutePath: string;
}

/**
 * Optional `sharp` interface — present when the dependency is installed (it is,
 * pulled in for image processing). Typed locally so the module compiles even if
 * the package is ever removed; we resolve it lazily and fall back to a safe
 * store-as-is path if the require fails at runtime.
 */
interface SharpModule {
  (input: Buffer): SharpInstance;
}
interface SharpInstance {
  rotate(): SharpInstance;
  resize(opts: { width: number; height: number; fit: 'cover'; position: 'centre' }): SharpInstance;
  webp(opts: { quality: number }): SharpInstance;
  toBuffer(): Promise<Buffer>;
}

/**
 * Owns the on-disk lifecycle of user avatar images.
 *
 * Responsibilities:
 *   - resolve the configurable uploads root (`UPLOADS_DIR`, default
 *     `<apps/api>/uploads`) and ensure `avatars/` exists;
 *   - validate that an uploaded buffer is ACTUALLY an image by magic bytes
 *     (never trusting the client mimetype/extension) and is within the size cap;
 *   - re-encode + resize to a square WEBP via `sharp` (strips EXIF + neutralises
 *     any malicious payload); if `sharp` cannot be loaded, fall back to storing
 *     the validated original bytes under the sniffed extension;
 *   - generate a SAFE, server-side filename (`<userId>-<short hash>.<ext>`) so
 *     the client filename never touches the filesystem (no path traversal);
 *   - delete a user's PRIOR local avatar file when a new one is stored (no
 *     history — only the current file is kept), ignoring external/missing paths.
 *
 * PROD: in production `UPLOADS_DIR` MUST point at a PERSISTENT Docker volume
 * (the container filesystem is ephemeral — avatars would vanish on redeploy),
 * and the files should be served by nginx directly from that volume rather than
 * through the Node process. See main.ts for the dev static-serving note.
 */
@Injectable()
export class AvatarStorageService {
  private readonly logger = new Logger(AvatarStorageService.name);

  /** Absolute path to the uploads root (resolved once at construction). */
  private readonly uploadsRoot: string;
  /** Absolute path to `<uploadsRoot>/avatars`. */
  private readonly avatarsDir: string;
  /** Lazily-resolved `sharp` (null until first lookup; `false` if unavailable). */
  private sharp: SharpModule | null | false = null;

  constructor(private readonly config: ConfigService) {
    const configured = this.config.get<string>('UPLOADS_DIR');
    // Default to `<apps/api>/uploads` in dev. `process.cwd()` is the API package
    // dir under `nest start` / `pnpm --filter`. An absolute UPLOADS_DIR is used
    // verbatim; a relative one is resolved against cwd.
    this.uploadsRoot = configured
      ? path.resolve(configured)
      : path.resolve(process.cwd(), 'uploads');
    this.avatarsDir = path.join(this.uploadsRoot, AVATAR_SUBDIR);
  }

  /** Absolute uploads root — exposed so main.ts can register static serving. */
  getUploadsRoot(): string {
    return this.uploadsRoot;
  }

  /**
   * Validate, normalise and persist an uploaded avatar for `userId`.
   *
   * Throws `BadRequestException` for an empty/oversize buffer or bytes that are
   * not a recognised image. On success the file is written atomically-ish (write
   * then the caller swaps the DB pointer) and the served URL + disk path are
   * returned. The caller is responsible for persisting `url` and then deleting
   * the previous file via {@link deleteByUrl}.
   */
  async store(userId: string, file: UploadedAvatar): Promise<StoredAvatar> {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Empty file');
    }
    if (file.buffer.length > MAX_AVATAR_BYTES) {
      throw new BadRequestException('File is too large (max 5 MB)');
    }

    // Trust the BYTES, not the client mimetype/extension.
    const signature = IMAGE_SIGNATURES.find((sig) => sig.matches(file.buffer));
    if (!signature) {
      throw new BadRequestException('Unsupported or invalid image file');
    }

    await fs.mkdir(this.avatarsDir, { recursive: true });

    const { bytes, ext } = await this.normalise(file.buffer, signature.ext);
    const filename = this.safeFilename(userId, ext);
    const absolutePath = path.join(this.avatarsDir, filename);

    // Final guard against path traversal: the resolved file MUST stay inside the
    // avatars dir (the generated filename is already safe, but assert it).
    if (path.dirname(absolutePath) !== this.avatarsDir) {
      throw new InternalServerErrorException('Resolved avatar path escaped the uploads dir');
    }

    await fs.writeFile(absolutePath, bytes, { mode: 0o644 });

    return { url: `${AVATAR_URL_PREFIX}/${filename}`, absolutePath };
  }

  /**
   * Delete a previously-stored avatar file given its stored `avatarUrl`.
   *
   * No-ops safely when:
   *   - the URL is null/empty,
   *   - the URL is EXTERNAL (a legacy absolute http(s) URL — not ours to delete),
   *   - the file is already gone (ENOENT).
   *
   * Path-traversal hardened: the basename is taken from the URL and re-joined to
   * the avatars dir; anything that would resolve outside it is ignored.
   */
  async deleteByUrl(avatarUrl: string | null | undefined): Promise<void> {
    if (!avatarUrl) return;
    // Only our own served paths are deletable. Skip absolute/external URLs.
    if (!avatarUrl.startsWith(`${AVATAR_URL_PREFIX}/`)) {
      return;
    }
    const filename = path.basename(avatarUrl);
    // `path.basename` already strips any directory components, but assert the
    // re-joined path stays within the avatars dir before unlinking.
    const target = path.join(this.avatarsDir, filename);
    if (path.dirname(target) !== this.avatarsDir) {
      return;
    }
    try {
      await fs.unlink(target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return; // already gone — fine
      }
      // A failed cleanup must not fail the request; log and move on.
      this.logger.warn(`Failed to delete old avatar ${filename}: ${(err as Error).message}`);
    }
  }

  /**
   * Re-encode + resize to a square 512×512 WEBP (auto-orient via EXIF, then the
   * orientation tag is dropped on re-encode — strips metadata + neutralises any
   * smuggled payload). Falls back to the validated ORIGINAL bytes under the
   * sniffed extension when `sharp` is unavailable.
   */
  private async normalise(
    input: Buffer,
    sniffedExt: ImageSignature['ext'],
  ): Promise<{ bytes: Buffer; ext: string }> {
    const sharp = this.resolveSharp();
    if (!sharp) {
      // SAFE FALLBACK (no sharp): store the magic-byte-validated original as-is.
      // Note: without re-encoding, EXIF is retained and animated GIFs keep all
      // frames. Validation by magic bytes + size cap + server-side filename
      // still applies.
      return { bytes: input, ext: sniffedExt };
    }
    try {
      const bytes = await sharp(input)
        .rotate() // apply EXIF orientation, then re-encode drops the metadata
        .resize({ width: AVATAR_EDGE_PX, height: AVATAR_EDGE_PX, fit: 'cover', position: 'centre' })
        .webp({ quality: 82 })
        .toBuffer();
      return { bytes, ext: 'webp' };
    } catch (err) {
      // A decode failure here means the bytes passed the magic-byte gate but are
      // structurally broken/hostile — reject rather than store something unsafe.
      this.logger.warn(`sharp failed to process avatar: ${(err as Error).message}`);
      throw new BadRequestException('Could not process image');
    }
  }

  /**
   * Build a collision-resistant, filesystem-safe filename from the OWNER id and
   * random bytes — NEVER the client filename. Shape: `<userId>-<8hex>.<ext>`.
   * `userId` is a Mongo ObjectId hex string (already `[0-9a-f]{24}`); the random
   * suffix makes the URL unguessable and avoids overwriting a concurrent write.
   */
  private safeFilename(userId: string, ext: string): string {
    const safeUser = createHash('sha256').update(userId).digest('hex').slice(0, 24);
    const rand = randomBytes(6).toString('hex'); // 12 hex chars
    const safeExt = ext.replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
    return `${safeUser}-${rand}.${safeExt}`;
  }

  /**
   * Lazily resolve `sharp` (cached). Uses a runtime require so a missing package
   * degrades to the store-as-is fallback instead of crashing module init.
   */
  private resolveSharp(): SharpModule | null {
    if (this.sharp === false) return null;
    if (this.sharp) return this.sharp;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('sharp') as SharpModule;
      this.sharp = mod;
      return mod;
    } catch {
      this.logger.warn(
        "`sharp` is not installed — avatars will be stored without re-encoding/resizing. " +
          'Run `pnpm --filter @ruletka/api add sharp` to enable square WEBP normalisation.',
      );
      this.sharp = false;
      return null;
    }
  }
}
