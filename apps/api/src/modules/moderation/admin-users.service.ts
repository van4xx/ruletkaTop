import { randomBytes, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, QueryFilter, Model, Types } from 'mongoose';

import type {
  AdminUserList,
  AdminUserListQuery,
  AdminUserSummary,
  CountryCode,
  Gender,
  Role,
} from '@ruletka/shared-types';

import { AuthService } from '../auth/auth.service';
import { User, UserDocument } from '../users/schemas/user.schema';

/** A `User` row as read with the fields the admin list needs. */
interface UserRow {
  _id: Types.ObjectId;
  email: string;
  role: Role;
  isBanned: boolean;
  emailVerified: boolean;
  createdAt: Date;
}

/** The presentation fields joined from the `profiles` collection. */
interface ProfileFields {
  nickname: string;
  isPremium: boolean;
  country: CountryCode | null;
  gender: Gender | null;
}

/**
 * Read + administrative write surface over the `users` collection for the admin
 * panel (role-guarded in {@link AdminUsersController}).
 *
 * The credential row (`users`) holds `email`/`role`/`isBanned`/`emailVerified`/
 * `createdAt`; presentation fields (`nickname`/`country`/`gender`) and the
 * denormalised `isPremium` flag live on the separate `profiles` document keyed
 * by `userId`. The list therefore reads `users` (the paginated source of truth)
 * and batch-joins `profiles` in ONE `$in` query — the same read-by-name +
 * batched-join pattern {@link LeaderboardService} uses — so this service takes
 * no hard dependency on the profiles/economy modules.
 *
 * `isBanned` is read straight off the user row, which is the exact source
 * {@link WsAuthService.isBanned} re-checks on every socket — so the list always
 * reflects live ban reality.
 */
@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(forwardRef(() => AuthService)) private readonly authService: AuthService,
  ) {}

  /**
   * Paginated user list with text search (email/nickname, case-insensitive) and
   * `role` / `banned` filters, newest first (`_id` desc, which equals creation
   * order). Returns one extra row beyond `limit` internally to compute
   * `hasMore`/`nextCursor` without a second count query.
   *
   * The `q` term is matched against `email` on the `users` collection AND
   * against `nickname` on `profiles`; nickname matches are resolved to their
   * `userId`s first and unioned into the `users` filter, so a search hits either
   * field while pagination stays on the single `users` cursor.
   */
  async listUsers(query: AdminUserListQuery): Promise<AdminUserList> {
    const filter = await this.buildFilter(query);

    const rows = (await this.userModel
      .find(filter)
      .sort({ _id: -1 })
      .limit(query.limit + 1)
      .select({ email: 1, role: 1, isBanned: 1, emailVerified: 1, createdAt: 1 })
      .lean()
      .exec()) as unknown as UserRow[];

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    const profiles = await this.loadProfiles(page.map((r) => r._id));
    const items = page.map((row) => this.toSummary(row, profiles.get(row._id.toString())));

    const nextCursor = hasMore ? (page[page.length - 1]?._id.toString() ?? null) : null;
    return { items, nextCursor, hasMore };
  }

  /** One user as an {@link AdminUserSummary}, or 404 if no such account. */
  async getUser(id: string): Promise<AdminUserSummary> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('User not found');
    }
    const row = (await this.userModel
      .findById(new Types.ObjectId(id))
      .select({ email: 1, role: 1, isBanned: 1, emailVerified: 1, createdAt: 1 })
      .lean()
      .exec()) as unknown as UserRow | null;
    if (!row) {
      throw new NotFoundException('User not found');
    }
    const profiles = await this.loadProfiles([row._id]);
    return this.toSummary(row, profiles.get(row._id.toString()));
  }

  /**
   * Set a user's role (admin-only — enforced by `@Roles('admin')` on the route
   * AND re-checked here as defence-in-depth via `callerRole`).
   *
   * Guards:
   *  - 404 if the target account does not exist;
   *  - 400 if an admin would demote THEMSELVES out of `admin` (avoids a trivial
   *    self-lockout); use another admin to change your own role.
   *
   * On a DEMOTION away from a privileged role (admin/moderator → lower) the
   * target's refresh sessions are revoked via
   * {@link AuthService.revokeAllSessions} so a cached access token cannot keep
   * exercising admin/mod powers until it expires.
   */
  async setRole(
    targetUserId: string,
    role: Role,
    callerRole: Role,
    callerUserId: string,
  ): Promise<AdminUserSummary> {
    // Defence-in-depth: the route is `@Roles('admin')`, but never trust that
    // alone for a privilege-granting write.
    if (callerRole !== 'admin') {
      throw new ForbiddenException('Only an admin can change roles');
    }
    if (!Types.ObjectId.isValid(targetUserId)) {
      throw new NotFoundException('User not found');
    }
    // Block the trivial self-lockout: an admin demoting their own account.
    if (targetUserId === callerUserId && role !== 'admin') {
      throw new BadRequestException('You cannot demote your own admin account');
    }

    const before = (await this.userModel
      .findById(new Types.ObjectId(targetUserId))
      .select({ role: 1 })
      .lean()
      .exec()) as { role: Role } | null;
    if (!before) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.userModel
      .findByIdAndUpdate(new Types.ObjectId(targetUserId), { $set: { role } }, { new: true })
      .select({ email: 1, role: 1, isBanned: 1, emailVerified: 1, createdAt: 1 })
      .lean()
      .exec();
    if (!updated) {
      throw new NotFoundException('User not found');
    }

    // Revoke sessions when stripping a privileged role so an already-minted
    // access token can't keep its old powers until it expires.
    if (isDemotion(before.role, role)) {
      await this.authService.revokeAllSessions(targetUserId);
    }

    const profiles = await this.loadProfiles([updated._id]);
    return this.toSummary(updated as unknown as UserRow, profiles.get(updated._id.toString()));
  }

  /**
   * Force-confirm a user's contact email (`emailVerified = true`) without the
   * emailed link — the admin override for the normal token flow
   * ({@link AuthService.verifyEmail}). Idempotent: re-running on an
   * already-verified account simply re-asserts the flag. A tombstoned
   * (`deletedAt`) account is treated as not-found. Returns the refreshed summary.
   */
  async verifyEmail(targetUserId: string): Promise<AdminUserSummary> {
    if (!Types.ObjectId.isValid(targetUserId)) {
      throw new NotFoundException('User not found');
    }
    const updated = await this.userModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(targetUserId), deletedAt: null },
        { $set: { emailVerified: true } },
        { new: true },
      )
      .select({ email: 1, role: 1, isBanned: 1, emailVerified: 1, createdAt: 1 })
      .lean()
      .exec();
    if (!updated) {
      throw new NotFoundException('User not found');
    }
    // TODO: audit once reachable (AuditService lives in AdminModule).
    const profiles = await this.loadProfiles([updated._id]);
    return this.toSummary(updated as unknown as UserRow, profiles.get(updated._id.toString()));
  }

  /**
   * Force-logout: revoke ALL of the target's live refresh sessions via
   * {@link AuthService.revokeAllSessions} (the same logout-everywhere primitive
   * the ban + password-reset flows use), so any minted access token can't be
   * refreshed and every device must re-authenticate. 404s an invalid id;
   * otherwise idempotent (revoking already-revoked sessions is a no-op).
   */
  async forceLogout(targetUserId: string): Promise<{ ok: true }> {
    if (!Types.ObjectId.isValid(targetUserId)) {
      throw new NotFoundException('User not found');
    }
    const exists = await this.userModel.exists({ _id: new Types.ObjectId(targetUserId) });
    if (!exists) {
      throw new NotFoundException('User not found');
    }
    await this.authService.revokeAllSessions(targetUserId);
    // TODO: audit once reachable (AuditService lives in AdminModule).
    return { ok: true };
  }

  /**
   * Admin account deletion (admin-only — gated by `@Roles('admin')` on the route).
   *
   * Implemented INLINE with the injected user model + {@link Connection} rather
   * than delegating to `UsersService.eraseAccount` (importing UsersModule here is
   * forbidden), but it mirrors the same erasure effect so an admin-initiated
   * delete is indistinguishable from the user's own right-to-be-forgotten:
   *   - anonymize the credential row (email → a unique non-routable tombstone,
   *     strip nickname-bearing fields/phone, rotate the password to an unusable
   *     hash, reset role, set `isBanned` + `deletedAt`);
   *   - best-effort redact the `profiles` document (clear nickname/bio/avatar);
   *   - hard-delete every refresh session (logout-everywhere).
   *
   * Guards against a double-delete (an already-tombstoned account 404s) so the
   * console gets a precise error rather than silently re-scrubbing. Best-effort +
   * non-transactional (honours the single-node dev-Mongo caveat): the profile
   * scrub is independent and a failure is logged, never failing the delete.
   */
  async deleteUser(targetUserId: string): Promise<{ ok: true }> {
    if (!Types.ObjectId.isValid(targetUserId)) {
      throw new NotFoundException('User not found');
    }
    const objectId = new Types.ObjectId(targetUserId);

    const user = await this.userModel.findById(objectId).exec();
    if (!user || user.deletedAt) {
      // Unknown OR already-erased → treat as not-found (guards double-delete).
      throw new NotFoundException('User not found');
    }

    const now = new Date();
    // A unique, non-routable tombstone email so the unique index is satisfied
    // and the original address is unrecoverable / re-usable.
    const tombstoneEmail = `deleted+${targetUserId}@removed.invalid`;
    const unusablePasswordHash = `disabled:${randomBytes(24).toString('hex')}`;

    // 1) Anonymize the credential row (retain as a tombstone, block login).
    user.email = tombstoneEmail;
    user.phone = null;
    user.passwordHash = unusablePasswordHash;
    user.role = 'user';
    user.isBanned = true;
    user.deletedAt = now;
    await user.save();

    // 2) Best-effort redact the profile (presentation PII). Independent of the
    //    credential scrub — a failure here is logged, not fatal.
    await this.connection
      .collection('profiles')
      .updateOne(
        { userId: objectId },
        {
          $set: {
            nickname: `deleted_${targetUserId.slice(-6)}_${randomUUID().slice(0, 6)}`,
            bio: null,
            status: null,
            avatarUrl: null,
            isPremium: false,
            premiumUntil: null,
          },
        },
      )
      .catch((err: unknown) =>
        this.logger.warn(
          `deleteUser: failed to scrub profile for ${targetUserId}: ${(err as Error).message}`,
        ),
      );

    // 3) Hard-delete every refresh session (logout-everywhere).
    await this.connection
      .collection('sessions')
      .deleteMany({ userId: objectId })
      .catch((err: unknown) =>
        this.logger.warn(
          `deleteUser: failed to delete sessions for ${targetUserId}: ${(err as Error).message}`,
        ),
      );

    // TODO: audit once reachable (AuditService lives in AdminModule).
    this.logger.log(`Admin-deleted account ${targetUserId}`);
    return { ok: true };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Build the Mongo filter for {@link listUsers} from the query DTO. */
  private async buildFilter(query: AdminUserListQuery): Promise<QueryFilter<UserDocument>> {
    const filter: QueryFilter<UserDocument> = {};
    if (query.role) {
      filter.role = query.role;
    }
    if (typeof query.banned === 'boolean') {
      filter.isBanned = query.banned;
    }
    // Keyset pagination: rows strictly older than the cursor (_id desc).
    if (query.cursor && Types.ObjectId.isValid(query.cursor)) {
      filter._id = { $lt: new Types.ObjectId(query.cursor) };
    }

    if (query.q && query.q.length > 0) {
      const rx = new RegExp(escapeRegExp(query.q), 'i');
      // Nickname lives on profiles → resolve matching userIds, then OR with email.
      const profileMatches = await this.connection
        .collection('profiles')
        .find({ nickname: rx }, { projection: { userId: 1 } })
        .limit(1000)
        .toArray();
      const nicknameUserIds = profileMatches
        .map((d) => (d as { userId?: Types.ObjectId }).userId)
        .filter((id): id is Types.ObjectId => id != null);

      filter.$or = [{ email: rx }, { _id: { $in: nicknameUserIds } }];
    }

    return filter;
  }

  /**
   * Batch-load the joined profile fields for a set of user ids in ONE `$in`
   * query, as `userId → fields`. Missing profiles simply fall back to defaults
   * in {@link toSummary}.
   */
  private async loadProfiles(
    userIds: readonly Types.ObjectId[],
  ): Promise<Map<string, ProfileFields>> {
    const out = new Map<string, ProfileFields>();
    if (userIds.length === 0) {
      return out;
    }
    const docs = await this.connection
      .collection('profiles')
      .find(
        { userId: { $in: userIds as Types.ObjectId[] } },
        { projection: { userId: 1, nickname: 1, isPremium: 1, country: 1, gender: 1 } },
      )
      .toArray();

    for (const doc of docs) {
      const p = doc as unknown as {
        userId: Types.ObjectId;
        nickname?: string;
        isPremium?: boolean;
        country?: CountryCode | null;
        gender?: Gender | null;
      };
      out.set(p.userId.toString(), {
        nickname: p.nickname ?? '',
        isPremium: p.isPremium ?? false,
        country: p.country ?? null,
        gender: p.gender ?? null,
      });
    }
    return out;
  }

  /** Shape a `users` row + its joined profile into the contract summary. */
  private toSummary(row: UserRow, profile: ProfileFields | undefined): AdminUserSummary {
    return {
      id: row._id.toString(),
      email: row.email,
      nickname: profile?.nickname ?? '',
      role: row.role,
      isPremium: profile?.isPremium ?? false,
      emailVerified: row.emailVerified === true,
      isBanned: row.isBanned === true,
      country: profile?.country ?? null,
      gender: profile?.gender ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

/** Privilege rank — higher means more power. Used to detect a demotion. */
const ROLE_RANK: Record<Role, number> = { user: 0, moderator: 1, admin: 2 };

/** Whether changing `from`→`to` strips privilege (so sessions must be revoked). */
function isDemotion(from: Role, to: Role): boolean {
  return ROLE_RANK[to] < ROLE_RANK[from];
}

/** Escape a user-supplied string for safe use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
