import { randomBytes, randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';

import type { Role } from '@ruletka/shared-types';

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
   *   - Settings: the user's settings document is deleted.
   *   - Sessions: every refresh session is hard-deleted (logout-everywhere).
   *   - Messages: the content the user authored is redacted to a tombstone,
   *     preserving the other participant's thread structure.
   *
   * The append-only coin LEDGER (`cointransactions`) is intentionally left
   * intact: those rows carry no direct PII (only the now-anonymized `userId`
   * link + financial deltas) and must be retained for accounting/audit. The
   * person is de-identified via the User anonymization above.
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

    // 2) Anonymize the profile (presentation PII).
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

    this.logger.log(
      `Erased account ${userId} (sessions=${sessionsDeleted}, messages=${messagesRedacted})`,
    );
    return { erased: true, messagesRedacted, sessionsDeleted };
  }

  /** Log a non-fatal scrub failure during {@link eraseAccount}. */
  private warnScrub(collection: string, err: unknown): void {
    this.logger.warn(`eraseAccount: failed to scrub ${collection}: ${(err as Error).message}`);
  }
}
