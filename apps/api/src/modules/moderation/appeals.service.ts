import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import * as argon2 from 'argon2';
import { Connection, Model, type QueryFilter, Types } from 'mongoose';

import type {
  Appeal as AppealContract,
  AppealStatus,
  CreateAppealDto,
  PaginationQuery,
} from '@ruletka/shared-types';

import { UsersService } from '../users/users.service';
import { AdminService } from './admin.service';
import { Appeal, AppealDocument } from './schemas/appeal.schema';

/** A page of appeals (newest-first) with an opaque cursor for the next page. */
export interface AppealPage {
  items: AppealContract[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** The decided appeal + the resulting ban state, from {@link AppealsService.resolve}. */
export interface ResolvedAppealResult {
  appeal: AppealContract;
  ban: { userId: string; isBanned: boolean };
}

/** A moderator may only ACCEPT (⇒ unban) or REJECT an appeal. */
const DECISION_STATUSES: readonly AppealStatus[] = ['accepted', 'rejected'];

/**
 * Owns the `moderation_appeals` collection — ban appeals filed by banned users.
 *
 * A banned account CANNOT authenticate (login is rejected), so the submit path
 * is CREDENTIAL-VERIFIED rather than token-authenticated: the appellant proves
 * identity with their email + password (verified here exactly as the login flow
 * does — argon2 against the stored hash, generic errors to avoid enumeration),
 * and the account must actually be banned. A single PENDING appeal per user is
 * allowed (re-submitting while one is open is a `409`).
 *
 * Moderator surface (role-guarded in the controller): {@link listAppeals}
 * (cursor-paginated, optional status filter) and {@link resolve} — `accept`
 * lifts the ban via {@link AdminService.unbanUser}, `reject` leaves it in place.
 * Both stamp the decision + deciding moderator on the row.
 */
@Injectable()
export class AppealsService {
  private readonly logger = new Logger(AppealsService.name);

  constructor(
    @InjectModel(Appeal.name) private readonly appealModel: Model<AppealDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly usersService: UsersService,
    private readonly adminService: AdminService,
  ) {}

  /**
   * File an appeal for a banned account. Credential-verified: bad email and bad
   * password yield the SAME generic `401` (no user enumeration). A non-banned
   * account is rejected `403` (nothing to appeal). A second pending appeal while
   * one is still open is a `409`. On success the appeal is written `pending`
   * with the email/nickname/banReason denormalised for the review queue.
   */
  async submitAppeal(dto: CreateAppealDto): Promise<AppealContract> {
    const email = dto.email.toLowerCase();
    const user = await this.usersService.findByEmailWithSecret(email);

    // Equalise the missing-user path against a real verify to flatten timing,
    // then fail with the SAME generic error as a wrong password.
    if (!user) {
      await argon2
        .verify(
          '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$3g2Z1Z1Z1Z1Z1Z1Z1Z1Z1Z1Z1Z1Z1Z1Z1Z1Z1Z1Z',
          dto.password,
        )
        .catch(() => false);
      throw new UnauthorizedException('Invalid email or password');
    }

    const ok = await argon2.verify(user.passwordHash, dto.password).catch(() => false);
    if (!ok) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Only a banned account has anything to appeal.
    if (!user.isBanned) {
      throw new ForbiddenException('This account is not banned');
    }

    const userId = user._id;

    // One open appeal at a time — re-submitting while pending is a duplicate.
    const pending = await this.appealModel
      .exists({ userId, status: 'pending' })
      .exec();
    if (pending) {
      throw new ConflictException('You already have a pending appeal under review');
    }

    const created = await this.appealModel.create({
      userId,
      email: user.email,
      nickname: await this.resolveNickname(userId),
      banReason: user.banReason ?? null,
      message: dto.message,
      status: 'pending',
    });
    return this.toContract(created);
  }

  /**
   * Cursor-paginated appeals queue, newest-first, optionally filtered by
   * `status`. `cursor` is the `_id` of the last item from the previous page
   * (older items have `_id < cursor`). Moderator-only (gated in the controller).
   */
  async listAppeals(pagination: PaginationQuery, status?: AppealStatus): Promise<AppealPage> {
    const filter: QueryFilter<AppealDocument> = {};
    if (status) {
      filter.status = status;
    }
    if (pagination.cursor) {
      if (!Types.ObjectId.isValid(pagination.cursor)) {
        // An invalid cursor yields an empty (terminal) page rather than a 500.
        return { items: [], nextCursor: null, hasMore: false };
      }
      filter._id = { $lt: new Types.ObjectId(pagination.cursor) };
    }

    // Fetch one extra row to determine `hasMore` without a second query.
    const rows = await this.appealModel
      .find(filter)
      .sort({ _id: -1 })
      .limit(pagination.limit + 1)
      .exec();

    const hasMore = rows.length > pagination.limit;
    const page = hasMore ? rows.slice(0, pagination.limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map((row) => this.toContract(row)),
      nextCursor: hasMore && last ? last._id.toString() : null,
      hasMore,
    };
  }

  /**
   * Decide an appeal: `accepted` (⇒ unban the user) or `rejected` (leave the ban
   * in place). Moderator-only (gated in the controller). Rejects any other
   * status, 404s an unknown id, and 409s an already-decided appeal (so two
   * moderators don't double-action). `decidedBy` records the acting moderator.
   *
   * On ACCEPT the unban runs FIRST (idempotent), then the appeal is stamped
   * `accepted` — so an accepted appeal always implies the ban was actually
   * lifted. The unban is the existing {@link AdminService.unbanUser} path, so it
   * stays consistent + auditable with the manual `POST /admin/users/:id/unban`.
   */
  async resolve(
    appealId: string,
    status: AppealStatus,
    decidedBy: string,
  ): Promise<ResolvedAppealResult> {
    if (!DECISION_STATUSES.includes(status)) {
      throw new BadRequestException('status must be accepted or rejected');
    }
    if (!Types.ObjectId.isValid(appealId)) {
      throw new NotFoundException('Appeal not found');
    }
    const appeal = await this.appealModel.findById(new Types.ObjectId(appealId)).exec();
    if (!appeal) {
      throw new NotFoundException('Appeal not found');
    }
    if (appeal.status !== 'pending') {
      throw new ConflictException('Appeal has already been decided');
    }

    const targetUserId = appeal.userId.toString();
    let isBanned = true;
    if (status === 'accepted') {
      // Lift the ban first so an accepted appeal always implies a real unban.
      const result = await this.adminService.unbanUser(targetUserId);
      isBanned = result.isBanned;
    }

    appeal.status = status;
    appeal.resolvedAt = new Date();
    appeal.decidedBy = Types.ObjectId.isValid(decidedBy) ? new Types.ObjectId(decidedBy) : null;
    await appeal.save();

    return { appeal: this.toContract(appeal), ban: { userId: targetUserId, isBanned } };
  }

  /**
   * Resolve a user's display nickname from `profiles` (read through the shared
   * {@link Connection} by collection name — the same escape hatch
   * {@link AdminService} uses — so this stays free of a hard ProfilesModule
   * dependency). Falls back to an empty string if the profile is missing.
   */
  private async resolveNickname(userId: Types.ObjectId): Promise<string> {
    try {
      const doc = await this.connection
        .collection('profiles')
        .findOne({ userId }, { projection: { nickname: 1 } });
      const nickname = (doc as { nickname?: string } | null)?.nickname;
      return typeof nickname === 'string' ? nickname : '';
    } catch (err) {
      this.logger.warn(
        `Failed to resolve nickname for appeal (user ${userId.toString()}): ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return '';
    }
  }

  /** Map a hydrated appeal document to the shared `Appeal` contract shape. */
  private toContract(doc: AppealDocument): AppealContract {
    return {
      id: doc._id.toString(),
      userId: doc.userId.toString(),
      email: doc.email,
      nickname: doc.nickname,
      banReason: doc.banReason ?? null,
      message: doc.message,
      status: doc.status,
      createdAt: doc.get('createdAt').toISOString(),
      resolvedAt: doc.resolvedAt ? doc.resolvedAt.toISOString() : null,
      decidedBy: doc.decidedBy ? doc.decidedBy.toString() : null,
    };
  }
}
