import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';

import {
  type GiftTransaction,
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
import { type ProfileSearchResult, ProfilesService } from './profiles.service';

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
  @ApiOperation({ summary: 'List gifts received by a user (newest first)' })
  @ApiParam({ name: 'id', description: 'Recipient user id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'Received gift transactions' })
  async getGifts(@Param('id') id: string): Promise<GiftTransaction[]> {
    return this.profilesService.getReceivedGifts(id);
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
