import { randomBytes, randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';

import type { Role } from '@ruletka/shared-types';

import { runAccountTeardown } from '../../common/account-teardown';
import {
  PAYMENTS_CANCEL_PORT,
  type PaymentsCancelPort,
} from '../../common/payments-cancel.port';
import { AvatarStorageService } from '../profiles/avatar-storage.service';
import { User, UserDocument } from './schemas/user.schema';

/** Input accepted by {@link UsersService.createUser}. */
export interface CreateUserInput {
  email: string;
  /** Pre-computed argon2 hash (hashing is owned by the auth module). */
  passwordHash: string;
  phone?: string | null;
  role?: Role;
  /** Consent timestamps captured at registration (152-ФЗ / GDPR). */
  acceptedTermsAt?: Date | null;
  acceptedPrivacyAt?: Date | null;
}

/** Outcome of an {@link UsersService.eraseAccount} request, for audit/logging. */
export interface EraseAccountResult {
  /** True if a (not-already-erased) account was anonymized by this call. */
  erased: boolean;
  /** Number of authored messages whose content was redacted. */
  messagesRedacted: number;
  /** Number of refresh sessions removed. */
  sessionsDeleted: number;
}

/**
 * The machine-readable bundle returned by {@link UsersService.exportAccount} —
 * the 152-ФЗ / GDPR data-access / portability "copy of your data" the privacy
 * policy promises. Secrets are NEVER included (passwordHash, refresh token
 * hashes). Large collections are bounded (newest-first) with a `truncated`
 * marker so the download stays a fixed, efficient size.
 */
export interface AccountExport {
  /** ISO timestamp the export was generated. */
  exportedAt: string;
  /** The bounded row cap applied to each large collection. */
  recordCap: number;
  /** Credential row MINUS passwordHash. */
  user: Record<string, unknown> | null;
  profile: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
  /** Active refresh sessions, with token hashes stripped. */
  sessions: Bounded;
  /** Direct messages the caller authored. */
  messages: Bounded;
  /** Coin ledger rows. */
  coinTransactions: Bounded;
  /** Gifts the caller sent and received. */
  giftsSent: Bounded;
  giftsReceived: Bounded;
  /** Payment / purchase history. */
  payments: Bounded;
  /** Abuse reports the caller filed. */
  reportsFiled: Bounded;
  /** Friendships the caller participates in (either direction). */
  friendships: Bounded;
}

/** A bounded slice of a collection plus whether more rows existed than the cap. */
export interface Bounded {
  items: Record<string, unknown>[];
  /** True when more rows existed than {@link AccountExport.recordCap}. */
  truncated: boolean;
}

/**
 * Per-collection row cap for {@link UsersService.exportAccount}. Bounds the
 * export to a fixed, predictable size (newest-first) so a heavy account can't
 * produce an unbounded download or hammer Mongo — the policy promises a "copy of
 * your data", not necessarily every historical row, and the `truncated` flag is
 * surfaced so the user knows the slice was capped.
 */
const EXPORT_RECORD_CAP = 1000;

/**
 * Data-access service for the `users` collection.
 *
 * Exported from {@link UsersModule} and consumed cross-module by `auth` (login /
 * registration) and by anyone needing to resolve an account by id. Methods are
 * intentionally low-level (no DTO shaping) — response shaping to `AuthUser` /
 * `PublicProfile` is the caller's job.
 *
 * `passwordHash` is `select: false` on the schema, so it is omitted by default
 * and only returned by {@link findByEmailWithSecret} for credential checks.
 *
 * The injected Mongoose {@link Connection} is used by {@link eraseAccount} to
 * anonymize/scrub data the user owns in OTHER modules' collections (profiles,
 * settings, sessions, messages) by collection name — the same
 * read/write-by-name pattern other services use — so account erasure does not
 * require a hard DI dependency on every owning module.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectConnection() private readonly connection: Connection,
    // Best-effort upstream billing cancel for account teardown. Optional so the
    // module wires up even where CloudPayments isn't bound; absent ⇒ the LOCAL
    // subscription terminal-state drive still runs (see PaymentsCancelPort docs).
    @Optional()
    @Inject(PAYMENTS_CANCEL_PORT)
    private readonly paymentsCancelPort?: PaymentsCancelPort,
    // Used by {@link eraseAccount} to fs.unlink the user's avatar FILE on disk
    // (the right-to-be-forgotten must remove the bytes, not just the DB pointer).
    // Optional so unit tests / minimal wirings can omit it — a missing service
    // simply skips the file unlink (the DB pointer is still nulled).
    @Optional()
    private readonly avatarStorage?: AvatarStorageService,
  ) {}

  /** Resolve an account by its Mongo id, or `null` if not found. */
  async findById(id: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    return this.userModel.findById(id).exec();
  }

  /**
   * Resolve an account by (lower-cased) email WITHOUT the password hash. Use
   * for existence checks and general lookups.
   */
  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  /**
   * Resolve an account by email INCLUDING the normally-hidden `passwordHash`.
   * Used exclusively by the auth login flow to verify credentials.
   */
  async findByEmailWithSecret(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).select('+passwordHash').exec();
  }

  /**
   * Resolve an account by id INCLUDING the normally-hidden `passwordHash`. Used
   * by the auth change-password flow to verify the caller's CURRENT password
   * before rotating it. Mirrors {@link findByEmailWithSecret}.
   */
  async findByIdWithSecret(id: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }
    return this.userModel.findById(id).select('+passwordHash').exec();
  }

  /**
   * Create a new account. The caller supplies the already-hashed password.
   * Pass an optional Mongoose `session` to enlist the insert in a transaction
   * (e.g. registration creating user + profile atomically).
   */
  async createUser(input: CreateUserInput, session?: ClientSession): Promise<UserDocument> {
    const docs: UserDocument[] = await this.userModel.create(
      [
        {
          email: input.email.toLowerCase(),
          passwordHash: input.passwordHash,
          phone: input.phone ?? null,
          role: input.role ?? 'user',
          isBanned: false,
          acceptedTermsAt: input.acceptedTermsAt ?? null,
          acceptedPrivacyAt: input.acceptedPrivacyAt ?? null,
        },
      ],
      session ? { session } : {},
    );
    const created = docs[0];
    if (!created) {
      throw new Error('User creation returned no document');
    }
    return created;
  }

  /**
   * Mark an account's email as confirmed (idempotent). Called by the auth
   * email-verification flow once a valid `email_verify` token is consumed.
   * Returns `true` if a (non-deleted) account was updated.
   */
  async markEmailVerified(userId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId)) {
      return false;
    }
    const res = await this.userModel
      .updateOne(
        { _id: new Types.ObjectId(userId), deletedAt: null },
        { $set: { emailVerified: true } },
      )
      .exec();
    return (res.modifiedCount ?? 0) > 0 || (res.matchedCount ?? 0) > 0;
  }

  /**
   * Replace an account's credential with a new (already-hashed) password.
   * Called by the auth password-reset flow after a valid `password_reset`
   * token is consumed. No-op for an unknown/invalid id (returns `false`).
   *
   * The caller is responsible for revoking the user's refresh sessions so a
   * stolen session cannot outlive the password change.
   */
  async updatePasswordHash(userId: string, passwordHash: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId)) {
      return false;
    }
    const res = await this.userModel
      .updateOne({ _id: new Types.ObjectId(userId), deletedAt: null }, { $set: { passwordHash } })
      .exec();
    return (res.modifiedCount ?? 0) > 0;
  }

  /**
   * Erase / anonymize an account — the 152-ФЗ ("право на забвение") / GDPR
   * right-to-be-forgotten action behind `DELETE /users/me`.
   *
   * The credential row is RETAINED as an anonymized tombstone (so re-use of the
   * freed email is detectable and foreign-key-style references don't dangle),
   * but every piece of personal data is scrubbed:
   *   - User: email/phone scrambled to a non-routable unique value, password
   *     rotated to an unusable random hash, `deletedAt` stamped, `isBanned` set
   *     (login is blocked), role reset to `user`.
   *   - Profile: nickname → `deleted_<short>`, status/avatar cleared, country
   *     reset to a neutral placeholder, languages & badges emptied, premium
   *     denormalisation cleared, view counter zeroed.
   *   - Avatar FILE: the on-disk image (read off the profile BEFORE the pointer
   *     is nulled) is fs.unlinked via {@link AvatarStorageService.deleteByUrl}.
   *   - Settings: the user's settings document is deleted.
   *   - Sessions: every refresh session is hard-deleted (logout-everywhere).
   *   - Messages: the content the user authored is redacted to a tombstone,
   *     preserving the other participant's thread structure.
   *   - Push + authored long-tail PII: device tokens / push subscriptions are
   *     deleted, and the free-text the user authored in gift notes, abuse
   *     reports and their own moderation-evidence frames is redacted — see
   *     {@link runAccountTeardown} → `runErasurePiiScrub`.
   *
   * The append-only coin LEDGER (`cointransactions`) and the financial
   * `payments` rows are intentionally left intact: they carry no direct PII
   * (only the now-anonymized `userId` link + financial deltas) and must be
   * retained for accounting/tax/audit. The person is de-identified via the User
   * anonymization above.
   *
   * Best-effort + idempotent: each collection is scrubbed independently (no
   * hard multi-doc transaction, honouring the single-node dev-Mongo caveat). A
   * second call on an already-erased account is a no-op.
   */
  async eraseAccount(userId: string): Promise<EraseAccountResult> {
    if (!Types.ObjectId.isValid(userId)) {
      return { erased: false, messagesRedacted: 0, sessionsDeleted: 0 };
    }
    const objectId = new Types.ObjectId(userId);

    const user = await this.userModel.findById(objectId).exec();
    if (!user || user.deletedAt) {
      // Unknown or already-erased → idempotent no-op.
      return { erased: false, messagesRedacted: 0, sessionsDeleted: 0 };
    }

    const now = new Date();
    const shortId = userId.slice(-6);
    // A unique, non-routable tombstone email so the unique index is satisfied
    // and the original address is unrecoverable / re-usable.
    const tombstoneEmail = `deleted+${userId}@deleted.invalid`;
    const unusablePasswordHash = `disabled:${randomBytes(24).toString('hex')}`;

    // 1) Anonymize the credential row (retain as a tombstone, block login).
    user.email = tombstoneEmail;
    user.phone = null;
    user.passwordHash = unusablePasswordHash;
    user.role = 'user';
    user.isBanned = true;
    user.deletedAt = now;
    await user.save();

    // 2) Anonymize the profile (presentation PII). Read the avatar URL FIRST
    //    (before it is nulled) so the on-disk file can be unlinked below.
    let avatarUrl: string | null = null;
    try {
      const profile = (await this.connection
        .collection('profiles')
        .findOne({ userId: objectId }, { projection: { avatarUrl: 1 } })) as {
        avatarUrl?: string | null;
      } | null;
      avatarUrl = typeof profile?.avatarUrl === 'string' ? profile.avatarUrl : null;
    } catch (err) {
      this.warnScrub('profiles (avatar read)', err);
    }

    await this.connection
      .collection('profiles')
      .updateOne(
        { userId: objectId },
        {
          $set: {
            nickname: `deleted_${shortId}_${randomUUID().slice(0, 6)}`,
            status: null,
            avatarUrl: null,
            country: 'ZZ', // user-assigned / neutral placeholder
            languages: [],
            badges: [],
            isPremium: false,
            premiumUntil: null,
            profileViews: 0,
          },
        },
      )
      .catch((err: unknown) => this.warnScrub('profiles', err));

    // 2b) Unlink the avatar FILE on disk (the DB pointer is now nulled; the bytes
    //     must go too for a complete right-to-be-forgotten). Best-effort: a
    //     missing service or a failed unlink must never abort the erasure.
    //     `deleteByUrl` already no-ops on null/external/missing files.
    if (this.avatarStorage) {
      await this.avatarStorage
        .deleteByUrl(avatarUrl)
        .catch((err: unknown) => this.warnScrub('avatar-file', err));
    }

    // 3) Delete settings (preference PII).
    await this.connection
      .collection('settings')
      .deleteOne({ userId: objectId })
      .catch((err: unknown) => this.warnScrub('settings', err));

    // 4) Hard-delete refresh sessions (revoke + remove every device).
    let sessionsDeleted = 0;
    try {
      const res = await this.connection.collection('sessions').deleteMany({ userId: objectId });
      sessionsDeleted = res.deletedCount ?? 0;
    } catch (err) {
      this.warnScrub('sessions', err);
    }

    // 5) Redact authored message content (keep the row so the peer's thread is
    //    intact, but strip the personal content).
    let messagesRedacted = 0;
    try {
      const res = await this.connection
        .collection('messages')
        .updateMany({ senderId: objectId }, { $set: { content: '[deleted]', type: 'text' } });
      messagesRedacted = res.modifiedCount ?? 0;
    } catch (err) {
      this.warnScrub('messages', err);
    }

    // 6) Billing + leaderboard/Top teardown (legal/GDPR + revenue-integrity):
    //    force-cancel the subscription (local terminal state + best-effort
    //    upstream CloudPayments cancel), zero the forfeit wallet balance, and
    //    expire any active paid Top placement. Best-effort throughout — a
    //    teardown hiccup must NEVER abort the erasure above.
    await runAccountTeardown(this.connection, objectId, 'erase', {
      onWarn: (m) => this.logger.warn(m),
      cancelUpstream: this.paymentsCancelPort
        ? (subscriptionId) => this.paymentsCancelPort!.cancelSubscription(subscriptionId)
        : undefined,
    }).catch((err: unknown) => this.warnScrub('account-teardown', err));

    this.logger.log(
      `Erased account ${userId} (sessions=${sessionsDeleted}, messages=${messagesRedacted})`,
    );
    return { erased: true, messagesRedacted, sessionsDeleted };
  }

  /**
   * Assemble a machine-readable COPY of the caller's data — the 152-ФЗ / GDPR
   * data-access / portability right the privacy policy promises ("request a copy
   * of your data"). Behind the authenticated, rate-limited, audit-logged
   * `GET /users/me/export`.
   *
   * Secrets are NEVER exported: the `passwordHash` is `select:false` and
   * additionally pruned defensively, and refresh-session token hashes are
   * stripped. Large collections are bounded to {@link EXPORT_RECORD_CAP}
   * newest-first rows (with a `truncated` flag) so the download is a fixed,
   * efficient size rather than an unbounded dump.
   *
   * Reads OTHER modules' collections by name (the same connection-by-name
   * pattern {@link eraseAccount} uses) so this takes no hard DI dependency on
   * every owning module. Returns `null`-ish empties for an unknown id.
   *
   * The access is AUDIT-LOGGED: a `user.data_export` row is appended to the
   * append-only `admin_audit_logs` collection (by name, mirroring how
   * `AuditService.log` writes it) so every data-access request is durably
   * recorded — exporting a full copy of one's data is a privacy-sensitive event
   * worth a tamper-evident trail. Best-effort: a failed audit write never blocks
   * the export the user is entitled to.
   */
  async exportAccount(userId: string, actorEmail?: string | null): Promise<AccountExport> {
    const exportedAt = new Date().toISOString();
    const empty: Bounded = { items: [], truncated: false };
    if (!Types.ObjectId.isValid(userId)) {
      return {
        exportedAt,
        recordCap: EXPORT_RECORD_CAP,
        user: null,
        profile: null,
        settings: null,
        sessions: empty,
        messages: empty,
        coinTransactions: empty,
        giftsSent: empty,
        giftsReceived: empty,
        payments: empty,
        reportsFiled: empty,
        friendships: empty,
      };
    }
    const objectId = new Types.ObjectId(userId);

    // Credential row MINUS the password hash (defence-in-depth: select:false
    // already hides it, but prune it explicitly so a future schema change can't
    // leak it into the export).
    const userDoc = await this.userModel.findById(objectId).lean().exec();
    let user: Record<string, unknown> | null = null;
    if (userDoc) {
      const { passwordHash: _omit, ...rest } = userDoc as unknown as Record<string, unknown>;
      void _omit;
      user = rest;
    }

    const [
      profile,
      settings,
      sessions,
      messages,
      coinTransactions,
      giftsSent,
      giftsReceived,
      payments,
      reportsFiled,
      friendships,
    ] = await Promise.all([
      this.exportOne('profiles', { userId: objectId }),
      this.exportOne('settings', { userId: objectId }),
      // Sessions: strip the secret token hashes (auth material, not PII the user
      // needs a copy of) but keep the device/ip/timestamps for transparency.
      this.exportMany('sessions', { userId: objectId }, ['tokenHash', 'replacedByHash']),
      this.exportMany('messages', { senderId: objectId }),
      this.exportMany('cointransactions', { userId: objectId }),
      this.exportMany('gifttransactions', { fromUserId: objectId }),
      this.exportMany('gifttransactions', { toUserId: objectId }),
      this.exportMany('payments', { userId: objectId }),
      this.exportMany('reports', { fromUserId: objectId }),
      this.exportMany('friendships', {
        $or: [{ requesterId: objectId }, { recipientId: objectId }],
      }),
    ]);

    // Durable, append-only audit of the data-access request. Written by name to
    // the same `admin_audit_logs` collection AuditService owns (no AdminModule
    // dependency / DI cycle). Best-effort — never blocks the export.
    try {
      await this.connection.collection('admin_audit_logs').insertOne({
        actorId: objectId,
        actorEmail: actorEmail ?? null,
        action: 'user.data_export',
        targetType: 'user',
        targetId: userId,
        meta: null,
        createdAt: new Date(),
      });
    } catch (err) {
      this.logger.warn(`exportAccount: failed to write audit log: ${(err as Error).message}`);
    }

    this.logger.log(`Exported account data for ${userId}`);
    return {
      exportedAt,
      recordCap: EXPORT_RECORD_CAP,
      user,
      profile,
      settings,
      sessions,
      messages,
      coinTransactions,
      giftsSent,
      giftsReceived,
      payments,
      reportsFiled,
      friendships,
    };
  }

  /** Read a single document for the export (or `null`), best-effort. */
  private async exportOne(
    collection: string,
    filter: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    try {
      return (await this.connection
        .collection(collection)
        .findOne(filter)) as Record<string, unknown> | null;
    } catch (err) {
      this.logger.warn(`exportAccount: failed to read ${collection}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Read a bounded, newest-first slice of a collection for the export. Fetches
   * one extra row to detect truncation without a second query, and strips any
   * `omitFields` (e.g. session token hashes) from every row. Best-effort.
   */
  private async exportMany(
    collection: string,
    filter: Record<string, unknown>,
    omitFields: readonly string[] = [],
  ): Promise<Bounded> {
    try {
      const rows = (await this.connection
        .collection(collection)
        .find(filter)
        .sort({ _id: -1 })
        .limit(EXPORT_RECORD_CAP + 1)
        .toArray()) as Record<string, unknown>[];
      const truncated = rows.length > EXPORT_RECORD_CAP;
      const page = truncated ? rows.slice(0, EXPORT_RECORD_CAP) : rows;
      const items =
        omitFields.length === 0
          ? page
          : page.map((row) => {
              const copy = { ...row };
              for (const field of omitFields) {
                delete copy[field];
              }
              return copy;
            });
      return { items, truncated };
    } catch (err) {
      this.logger.warn(`exportAccount: failed to read ${collection}: ${(err as Error).message}`);
      return { items: [], truncated: false };
    }
  }

  /** Log a non-fatal scrub failure during {@link eraseAccount}. */
  private warnScrub(collection: string, err: unknown): void {
    this.logger.warn(`eraseAccount: failed to scrub ${collection}: ${(err as Error).message}`);
  }
}
