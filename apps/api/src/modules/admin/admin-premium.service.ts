import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';

import type { AdminPremiumList, AdminSubscriber } from '@ruletka/shared-types';

import { PremiumService } from '../premium/premium.service';

/** Subscribers per page in the premium list. */
const PAGE = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A `subscriptions` row as read for the list. */
interface SubRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  plan: string;
  status: string;
  startedAt?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
}

/**
 * Admin premium surface. REAL — the subscriber list reads `subscriptions`
 * (excluding the `none` placeholder rows) and batch-joins `users` + `profiles`
 * in one `$in` each (the established read-by-name + batched-join pattern); grant
 * / revoke route through the exported {@link PremiumService} so entitlement and
 * the profile `isPremium` mirror stay authoritative.
 */
@Injectable()
export class AdminPremiumService {
  constructor(
    private readonly premiumService: PremiumService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * A page of subscribers (those with a real plan), newest first, plus the
   * active-entitlement count. Keyset-paginated on `_id`.
   */
  async list(cursor?: string): Promise<AdminPremiumList> {
    const subs = this.connection.collection('subscriptions');

    // Plain native-driver filter (reads `subscriptions` by name, not via a model).
    const filter: Record<string, unknown> = { status: { $ne: 'none' } };
    if (cursor && Types.ObjectId.isValid(cursor)) {
      filter._id = { $lt: new Types.ObjectId(cursor) };
    }

    const [rows, activeCount] = await Promise.all([
      subs
        .find(filter, {
          projection: {
            userId: 1,
            plan: 1,
            status: 1,
            startedAt: 1,
            currentPeriodEnd: 1,
            cancelAtPeriodEnd: 1,
          },
        })
        .sort({ _id: -1 })
        .limit(PAGE + 1)
        .toArray() as unknown as Promise<SubRow[]>,
      subs.countDocuments({ status: 'active', currentPeriodEnd: { $gt: new Date() } }),
    ]);

    const hasMore = rows.length > PAGE;
    const page = hasMore ? rows.slice(0, PAGE) : rows;

    const userIds = page.map((r) => r.userId);
    const [emails, nicknames] = await Promise.all([
      this.loadEmails(userIds),
      this.loadNicknames(userIds),
    ]);

    const items: AdminSubscriber[] = page.map((r) => {
      const uid = r.userId.toString();
      return {
        userId: uid,
        nickname: nicknames.get(uid) ?? '',
        email: emails.get(uid) ?? '',
        plan: r.plan,
        status: r.status,
        startedAt: r.startedAt ? r.startedAt.toISOString() : null,
        currentPeriodEnd: r.currentPeriodEnd ? r.currentPeriodEnd.toISOString() : null,
        cancelAtPeriodEnd: r.cancelAtPeriodEnd ?? false,
      };
    });

    const last = page.at(-1);
    return {
      items,
      activeCount,
      nextCursor: hasMore && last ? last._id.toString() : null,
      hasMore,
    };
  }

  /**
   * Comp `days` of premium for a user (extends from now). Routes through
   * {@link PremiumService.activate} (plan `comp`) so the profile mirror + badge
   * are kept in sync. `404` on an invalid id.
   */
  async grant(userId: string, days: number): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }
    const currentPeriodEnd = new Date(Date.now() + days * DAY_MS);
    await this.premiumService.activate(userId, 'comp', currentPeriodEnd);
  }

  /** Revoke a user's premium (cancel + lapse). `404` on an invalid id. */
  async revoke(userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }
    await this.premiumService.cancel(userId);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** Batch-load `userId → email` from `users` in one `$in`. */
  private async loadEmails(userIds: readonly Types.ObjectId[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (userIds.length === 0) {
      return out;
    }
    const docs = await this.connection
      .collection('users')
      .find({ _id: { $in: userIds as Types.ObjectId[] } }, { projection: { email: 1 } })
      .toArray();
    for (const d of docs) {
      out.set(d._id.toString(), (d as { email?: string }).email ?? '');
    }
    return out;
  }

  /** Batch-load `userId → nickname` from `profiles` in one `$in`. */
  private async loadNicknames(userIds: readonly Types.ObjectId[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (userIds.length === 0) {
      return out;
    }
    const docs = await this.connection
      .collection('profiles')
      .find(
        { userId: { $in: userIds as Types.ObjectId[] } },
        { projection: { userId: 1, nickname: 1 } },
      )
      .toArray();
    for (const d of docs) {
      const p = d as unknown as { userId: Types.ObjectId; nickname?: string };
      out.set(p.userId.toString(), p.nickname ?? '');
    }
    return out;
  }
}
