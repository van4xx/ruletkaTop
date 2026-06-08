import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';

import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_MAX_BYTES,
  type AvatarUploadResponse,
  type JwtPayload,
  type ProfileSearchQuery,
  profileSearchQuerySchema,
  type PublicProfile,
  type UpdateProfileDto,
  updateProfileSchema,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
// Local RUNTIME re-declaration of the access-token payload schema (the API
// imports only TYPES from shared-types; runtime zod values used directly must
// be local — see src/common/jwt-payload.schema.ts).
import { jwtPayloadSchema } from '../../common/jwt-payload.schema';
import { createZodValidationPipe } from '../../common/zod-validation.pipe';
import { AvatarStorageService, type UploadedAvatar } from './avatar-storage.service';
import {
  type ProfileSearchResult,
  ProfilesService,
  type PublicGiftTransaction,
} from './profiles.service';

/**
 * `AVATAR_ALLOWED_MIME_TYPES` is a readonly tuple of literals; multer's
 * `fileFilter` compares the incoming mimetype against it. This is only a FIRST
 * gate — the bytes are independently sniffed by magic-number in
 * {@link AvatarStorageService.store}, so a spoofed mimetype never reaches disk.
 */
const ALLOWED_MIME_SET = new Set<string>(AVATAR_ALLOWED_MIME_TYPES);

/**
 * REST surface for user profiles under `/profiles`.
 *
 * `GET /search` requires auth (it filters relative to the caller). `GET /:id`
 * is public for discovery but enforces the target's `whoCanViewProfile` privacy
 * setting — it OPTIONALLY decodes a bearer token to identify the viewer (owner
 * self-views are ungated and never inflate the counter; friends-only profiles
 * require an accepted friendship). Mutations require a valid access token and
 * only ever touch the caller's own profile (`/me`).
 */
@ApiTags('profiles')
@Controller('profiles')
export class ProfilesController {
  constructor(
    private readonly profilesService: ProfilesService,
    private readonly jwtService: JwtService,
    private readonly avatarStorage: AvatarStorageService,
  ) {}

  @Get('search')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Search profiles (excludes self + blocked users)' })
  @ApiQuery({ name: 'q', required: false, description: 'Nickname prefix' })
  @ApiQuery({ name: 'gender', required: false })
  @ApiQuery({ name: 'country', required: false })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse({ description: 'Cursor-paginated public profiles' })
  async search(
    @CurrentUser() user: JwtPayload,
    @Query(createZodValidationPipe(profileSearchQuerySchema)) query: ProfileSearchQuery,
  ): Promise<ProfileSearchResult> {
    return this.profilesService.searchProfiles(user.sub, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a public profile by user id (privacy-gated)' })
  @ApiParam({ name: 'id', description: 'Owning user id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'Public profile projection' })
  async getProfile(@Param('id') id: string, @Req() req: Request): Promise<PublicProfile> {
    const viewerId = this.tryGetViewerId(req);
    // Visibility-gated read (everyone / friends / nobody, owner always allowed).
    const profile = await this.profilesService.getPublicProfileFor(viewerId, id);
    // Count the view only for non-owners, throttled per viewer (or per IP for
    // anonymous viewers) so a refresh loop can't inflate the counter.
    if (viewerId !== id) {
      const viewerKey = viewerId ?? `ip:${req.ip ?? 'unknown'}`;
      await this.profilesService.recordView(id, viewerKey);
    }
    return profile;
  }

  @Get(':id/gifts')
  @ApiOperation({ summary: 'List gifts received by a user (privacy-gated, newest first)' })
  @ApiParam({ name: 'id', description: 'Recipient user id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'Received gift transactions (sender id omitted)' })
  async getGifts(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<PublicGiftTransaction[]> {
    // Resolve the (optional) viewer and enforce the SAME `whoCanViewProfile`
    // visibility as the profile read: a stranger viewing a friends-only / nobody
    // profile gets the same `404` as `GET /profiles/:id`, never the gift wall.
    const viewerId = this.tryGetViewerId(req);
    return this.profilesService.getReceivedGifts(viewerId, id);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: "Update the authenticated user's own profile" })
  @ApiOkResponse({ description: 'Updated public profile' })
  async updateMe(
    @CurrentUser() user: JwtPayload,
    @Body(createZodValidationPipe(updateProfileSchema)) dto: UpdateProfileDto,
  ): Promise<PublicProfile> {
    return this.profilesService.updateOwnProfile(user.sub, dto);
  }

  /**
   * Upload (or replace) the authenticated user's avatar.
   *
   * `multipart/form-data` with a single image part named `file`. The file is
   * buffered IN MEMORY (multer `memoryStorage`) — never written under a client
   * path — then validated (size cap + magic-byte image sniff), re-encoded to a
   * square WEBP (EXIF stripped) and stored under `/uploads/avatars/` with a
   * SERVER-GENERATED filename. On success the user's PRIOR avatar file is
   * deleted (only the current file is kept) and the updated public profile is
   * returned.
   *
   * Limits/allowlist come from the shared contract (`AVATAR_MAX_BYTES`,
   * `AVATAR_ALLOWED_MIME_TYPES`); the mimetype check here is a fast first gate,
   * with the authoritative content validation done on the bytes server-side.
   */
  @Post('me/avatar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: "Upload/replace the authenticated user's avatar image" })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOkResponse({ description: 'Updated public profile with the new avatar URL' })
  @UseInterceptors(
    // No explicit `storage` → multer's DEFAULT in-memory storage, so the file
    // arrives as `file.buffer` (never written to a client-controlled path).
    // Avoiding an explicit `memoryStorage()` keeps this off a direct `multer`
    // import (multer is a transitive dep of @nestjs/platform-express).
    FileInterceptor('file', {
      limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
      fileFilter: (
        _req: unknown,
        file: { mimetype: string },
        cb: (error: Error | null, acceptFile: boolean) => void,
      ) => {
        // First-line mimetype gate (the bytes are re-validated downstream).
        if (ALLOWED_MIME_SET.has(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Unsupported image type'), false);
        }
      },
    }),
  )
  async uploadAvatar(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: UploadedAvatar | undefined,
  ): Promise<AvatarUploadResponse> {
    if (!file) {
      throw new BadRequestException('No file uploaded (expected field "file")');
    }
    // Remember the path we're superseding so we can delete it AFTER the new one
    // is safely stored + persisted (never leave the user avatar-less on failure).
    const previousUrl = await this.profilesService.getAvatarUrl(user.sub);
    const stored = await this.avatarStorage.store(user.sub, file);
    try {
      const profile = await this.profilesService.setAvatar(user.sub, stored.url);
      // Best-effort cleanup of the old file (ignored if external/missing).
      await this.avatarStorage.deleteByUrl(previousUrl);
      return profile;
    } catch (err) {
      // Persisting the new path failed — remove the orphaned file we just wrote
      // so the uploads dir doesn't accumulate garbage.
      await this.avatarStorage.deleteByUrl(stored.url);
      throw err;
    }
  }

  /**
   * Reset the authenticated user's avatar to the default: clears the stored
   * `avatarUrl` and deletes the underlying local file (if it is one of ours).
   * Returns the updated public profile.
   */
  @Delete('me/avatar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: "Reset the authenticated user's avatar to the default" })
  @ApiOkResponse({ description: 'Updated public profile with no avatar' })
  async deleteAvatar(@CurrentUser() user: JwtPayload): Promise<AvatarUploadResponse> {
    const previousUrl = await this.profilesService.getAvatarUrl(user.sub);
    const profile = await this.profilesService.clearAvatar(user.sub);
    await this.avatarStorage.deleteByUrl(previousUrl);
    return profile;
  }

  /**
   * Best-effort extraction of the viewer's id from a bearer token WITHOUT
   * requiring auth. The token is verified (HS256, pinned in the shared
   * JwtModule config) and its payload shape is validated with the shared Zod
   * schema, so a malformed-but-signed token is not trusted. Returns `null` when
   * no/invalid token is present so the public route still serves anonymous
   * callers.
   */
  private tryGetViewerId(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return null;
    }
    const token = header.slice('Bearer '.length).trim();
    try {
      const decoded = this.jwtService.verify<Record<string, unknown>>(token);
      const parsed = jwtPayloadSchema.safeParse(decoded);
      return parsed.success ? parsed.data.sub : null;
    } catch {
      return null;
    }
  }
}
