import {
  Controller,
  Get,
  Header,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';

import type {
  AchievementsCatalogue,
  JwtPayload,
  MyAchievements,
  PublicAchievements,
} from '@ruletka/shared-types';

import { CurrentUser } from '../../common/current-user.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { jwtPayloadSchema } from '../../common/jwt-payload.schema';
import { ProfilesService } from '../profiles/profiles.service';
import { AchievementsService } from './achievements.service';

/**
 * REST surface for achievements under `/achievements`.
 *
 * - `GET /catalogue`      — public, cacheable (`s-maxage=3600`). Returns the
 *                           static catalogue. Safe to expose unauthenticated
 *                           per the spec: it never reveals user state.
 * - `GET /me`             — authenticated. The owner's full self-view
 *                           (unlocked + progress + `checkedAt` cursor).
 * - `GET /user/:userId`   — public discovery surface. Privacy-gated EXACTLY
 *                           like `GET /profiles/:id`: a `whoCanViewProfile`
 *                           `nobody`/`friends`-only target throws `404` for a
 *                           stranger via `getPublicProfileFor`, so this never
 *                           leaks badges past the same gate as the rest of the
 *                           profile reads.
 */
@ApiTags('achievements')
@Controller('achievements')
export class AchievementsController {
  constructor(
    private readonly achievementsService: AchievementsService,
    private readonly profilesService: ProfilesService,
    private readonly jwtService: JwtService,
  ) {}

  @Get('catalogue')
  // Cache at the edge for an hour — the catalogue is static across users and
  // identical for every locale (titles live on the client). Browser caches
  // the same way so a single tab load suffices.
  @Header('Cache-Control', 'public, max-age=300, s-maxage=3600')
  @ApiOperation({ summary: 'Static achievements catalogue (public, cacheable)' })
  @ApiOkResponse({ description: 'Catalogue rows (id, category, icon, tiers, hidden?)' })
  getCatalogue(): AchievementsCatalogue {
    return { catalogue: this.achievementsService.getCatalogue() };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: "Read the authenticated user's unlocks + per-badge progress" })
  @ApiOkResponse({ description: 'Unlocked rows + progress slices + server-stamped `checkedAt`' })
  async getMy(@CurrentUser() user: JwtPayload): Promise<MyAchievements> {
    return this.achievementsService.getMyAchievements(user.sub, null);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: "Read a user's public unlocks (whoCanViewProfile-gated)" })
  @ApiParam({ name: 'userId', description: 'Owning user id (Mongo ObjectId)' })
  @ApiOkResponse({ description: 'Unlocked rows visible to the caller' })
  async getPublic(
    @Param('userId') userId: string,
    @Req() req: Request,
  ): Promise<PublicAchievements> {
    // Reuse the SAME privacy gate as `GET /profiles/:id`: optionally decode the
    // bearer to identify the viewer, then ask ProfilesService to enforce
    // `whoCanViewProfile` + block relations. A denied view throws `404`, which
    // is what we want here too (no badges-shaped data leak past the gate).
    const viewerId = this.tryGetViewerId(req);
    await this.profilesService.getPublicProfileFor(viewerId, userId);
    return this.achievementsService.getPublicAchievements(userId);
  }

  /**
   * Optionally decode the bearer token to identify the viewer. Identical
   * shape to `ProfilesController.tryGetViewerId` — we don't share the helper
   * because a single controller shouldn't depend on another controller's
   * private surface, and the tiny duplication keeps this module a clean leaf
   * import of `ProfilesModule`.
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
