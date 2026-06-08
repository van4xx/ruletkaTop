import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import * as argon2 from 'argon2';
import { ClientSession, Connection, Model, Types } from 'mongoose';

import type {
  AuthResponse,
  AuthSession,
  AuthUser,
  ChangePasswordDto,
  JwtPayload,
  LoginDto,
  RegisterDto,
} from '@ruletka/shared-types';

import { MailerService } from '../mail/mailer.service';
import { Profile, ProfileDocument } from '../profiles/schemas/profile.schema';
import { UsersService } from '../users/users.service';
import { CaptchaService } from './captcha.service';
import { FingerprintService } from './fingerprint.service';
import { Session, SessionDocument } from './schemas/session.schema';
import {
  VerificationToken,
  VerificationTokenDocument,
  type VerificationTokenPurpose,
} from './schemas/verification-token.schema';

/** Minimum age (years) required to register an account. */
const MIN_AGE_YEARS = 18;

/** MongoDB duplicate-key error code. */
const DUPLICATE_KEY_CODE = 11000;

/** Lifetime of an email-verification token (24h). */
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

/** Lifetime of a password-reset token (1h — short so a leaked link self-expires). */
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/**
 * Bytes of entropy in an emailed token (32 bytes → 64 hex chars, comfortably
 * above the contract's 16-char floor and infeasible to guess).
 */
const TOKEN_BYTES = 32;

/**
 * Consecutive failed logins (per email) after which we lock the account for
 * {@link LOGIN_LOCK_MS}. Brute-force mitigation backed by the Session schema's
 * sibling collection is overkill; we track counters in-memory per process which
 * is sufficient as a defence-in-depth signal (the real rate limit lives at the
 * edge / gateway).
 */
const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

/**
 * ROTATION GRACE window. When a refresh token was rotated out (`replacedByHash`
 * set) less than this long ago and was NOT explicitly revoked, presenting it
 * again is treated as a benign concurrent/double refresh — multiple tabs, or a
 * page reload racing an already-open tab, each present the SAME current cookie;
 * the loser of the rotation race would otherwise look like a replayed token and
 * burn the whole family (logging the user out everywhere).
 *
 * Within the grace window we re-issue idempotently against the recorded
 * successor instead of revoking. Outside it (a true replay long after rotation),
 * or for any revoked token, genuine reuse detection still burns the family. 20s
 * comfortably covers slow-mobile double-loads while staying far below the access
 * token TTL.
 */
const ROTATION_GRACE_MS = 20_000;

/**
 * A small denylist of the most-breached passwords. The zod `passwordSchema`
 * already enforces length (≥8); this rejects the trivially-guessable strings
 * that still pass that bar. Compared case-insensitively. Kept intentionally
 * short (defence-in-depth, not a substitute for a full HIBP check).
 */
const TOP_COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'qwertyuiop',
  'password!',
  'iloveyou',
  'admin123',
  'welcome1',
  'letmein123',
  'abc12345',
  'monkey123',
  '111111111',
  '000000000',
  'dragon123',
  'sunshine1',
  'princess1',
]);

/** Argon2id parameters (OWASP-aligned defaults for an interactive login). */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

/** Type guard for a MongoDB duplicate-key write error. */
function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: number }).code === DUPLICATE_KEY_CODE
  );
}

/** Best-effort client context captured on a session for audit/security. */
export interface SessionContext {
  ip?: string | null;
  userAgent?: string | null;
}

/** Refresh-token JWT payload (carries the rotation family for reuse defence). */
interface RefreshTokenPayload extends JwtPayload {
  /** Rotation family id, shared across all rotations of one login. */
  family: string;
  /** Per-token nonce so each issued refresh token is unique even same-second. */
  jti: string;
}

/** Tracks failed-login pressure for an email within the current process. */
interface LoginAttemptState {
  count: number;
  lockedUntil: number | null;
}

/**
 * Owns authentication: registration, login, refresh-token rotation and logout.
 *
 * Tokens — access tokens are signed by the globally-provided {@link JwtService}
 * (configured in `CommonModule` from `JWT_ACCESS_SECRET`/`JWT_ACCESS_TTL`).
 * Refresh tokens are signed with a SEPARATE secret/TTL
 * (`JWT_REFRESH_SECRET`/`JWT_REFRESH_TTL`) read from {@link ConfigService} and
 * passed explicitly to `signAsync`.
 *
 * Refresh sessions — every issued refresh token is persisted as a {@link Session}
 * row storing only the token's SHA-256 hash plus its rotation `family`. On
 * refresh the presented token must match a live (not replaced, not revoked,
 * unexpired) row; we then mark it replaced and mint a successor in the same
 * family. Presenting an already-replaced or revoked token is treated as REUSE
 * and revokes the entire family.
 *
 * Exported from {@link AuthModule} for any module needing token issuance.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /** In-process failed-login counters, keyed by lower-cased email. */
  private readonly loginAttempts = new Map<string, LoginAttemptState>();

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly captchaService: CaptchaService,
    private readonly fingerprintService: FingerprintService,
    @InjectModel(Session.name)
    private readonly sessionModel: Model<SessionDocument>,
    @InjectModel(Profile.name)
    private readonly profileModel: Model<ProfileDocument>,
    @InjectModel(VerificationToken.name)
    private readonly verificationTokenModel: Model<VerificationTokenDocument>,
    private readonly mailerService: MailerService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  // ── Registration ──────────────────────────────────────────────────────────

  /**
   * Register a new account: validate 18+, hash the password (argon2id), then
   * create the `User` and its 1:1 `Profile` atomically (single transaction when
   * the deployment's Mongo supports it; otherwise sequential best-effort with
   * compensating cleanup). Issues an access/refresh pair and persists the
   * refresh session. Returns the {@link AuthResponse}.
   */
  async register(dto: RegisterDto, ctx: SessionContext = {}): Promise<AuthResponse> {
    // Bot gate: verify the CAPTCHA token before doing any work. No-op (always
    // passes) unless `TURNSTILE_SECRET` is configured (see CaptchaService).
    const captchaOk = await this.captchaService.verify(dto.captchaToken, ctx.ip);
    if (!captchaOk) {
      throw new BadRequestException('CAPTCHA verification failed');
    }

    // Ban-evasion gate: block re-registration from a device/IP whose
    // fingerprint is tied to an active ban (fails OPEN on storage errors).
    if (await this.fingerprintService.isBanned(ctx)) {
      throw new ForbiddenException('Registration is not allowed from this device or network');
    }

    // Consent gate (152-ФЗ / GDPR): the user must accept the Terms of Service
    // and Privacy Policy. The contract field is optional+additive, so enforce
    // it here; we record the acceptance instant on the User.
    if (dto.acceptedTerms !== true) {
      throw new BadRequestException('You must accept the Terms of Service and Privacy Policy');
    }

    const birthDate = this.parseBirthDate(dto.birthDate);
    if (this.computeAge(birthDate) < MIN_AGE_YEARS) {
      throw new BadRequestException('Must be at least 18 years old');
    }

    this.assertPasswordAcceptable(dto.password);

    const email = dto.email.toLowerCase();
    if (await this.usersService.findByEmail(email)) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);
    const acceptedAt = new Date();

    const { userId, role, isPremium } = await this.createUserWithProfile(
      { ...dto, email },
      passwordHash,
      birthDate,
      acceptedAt,
    );

    const authUser: AuthUser = {
      id: userId,
      email,
      role,
      nickname: dto.nickname,
      isPremium,
      // A brand-new account is always unverified until the emailed link is used.
      emailVerified: false,
    };
    const tokens = await this.issueSession({ sub: userId, role, isPremium }, randomUUID(), ctx);

    // Fire the verification email — BEST-EFFORT: a mail outage (or no SMTP in
    // dev) must NEVER fail registration. Mint a token + send, swallowing errors.
    await this.requestEmailVerification(userId, email);

    return { user: authUser, tokens };
  }

  /**
   * Create the `User` + `Profile` pair. Prefers a transaction (replica
   * set / Mongo ≥4.0); if the topology rejects transactions, falls back to a
   * sequential create that rolls the user back should profile creation fail, so
   * we never leak a credential row without a profile.
   */
  private async createUserWithProfile(
    dto: RegisterDto & { email: string },
    passwordHash: string,
    birthDate: Date,
    acceptedAt: Date,
  ): Promise<{ userId: string; role: AuthUser['role']; isPremium: boolean }> {
    const session = this.transactionsSupported === false ? null : await this.startSessionOrNull();
    if (session) {
      try {
        let result!: { userId: string; role: AuthUser['role']; isPremium: boolean };
        await session.withTransaction(async () => {
          result = await this.insertUserAndProfile(
            dto,
            passwordHash,
            birthDate,
            acceptedAt,
            session,
          );
        });
        this.transactionsSupported = true;
        return result;
      } catch (err) {
        if (!this.isTransactionUnsupported(err)) {
          throw this.translateCreationError(err);
        }
        // Topology rejects transactions (e.g. single-node dev mongo reached via
        // directConnection). Remember it and fall through to sequential writes.
        this.transactionsSupported = false;
      } finally {
        await session.endSession().catch(() => undefined);
      }
    }

    return this.createUserWithProfileSequential(dto, passwordHash, birthDate, acceptedAt);
  }

  /**
   * No-transaction fallback (standalone / non-replica-set topology in local
   * dev): sequential create that rolls the user back should profile creation
   * fail, so we never leak a credential row without a profile.
   */
  private async createUserWithProfileSequential(
    dto: RegisterDto & { email: string },
    passwordHash: string,
    birthDate: Date,
    acceptedAt: Date,
  ): Promise<{ userId: string; role: AuthUser['role']; isPremium: boolean }> {
    const user = await this.usersService
      .createUser({
        email: dto.email,
        passwordHash,
        acceptedTermsAt: acceptedAt,
        acceptedPrivacyAt: acceptedAt,
      })
      .catch((err: unknown) => {
        throw this.translateCreationError(err);
      });
    try {
      await this.insertProfile(user._id.toString(), dto, birthDate);
    } catch (err) {
      // Compensate: remove the orphaned user so the email can be reused.
      await this.connection
        .collection('users')
        .deleteOne({ _id: user._id })
        .catch(() => undefined);
      throw this.translateCreationError(err);
    }
    return { userId: user._id.toString(), role: user.role, isPremium: false };
  }

  /** True if an error indicates the Mongo topology lacks transaction support. */
  private isTransactionUnsupported(err: unknown): boolean {
    const message =
      typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message?: unknown }).message ?? '')
        : '';
    const codeName =
      typeof err === 'object' && err !== null && 'codeName' in err
        ? String((err as { codeName?: unknown }).codeName ?? '')
        : '';
    return (
      /does not support retryable writes/i.test(message) ||
      /transaction numbers are only allowed on a replica set/i.test(message) ||
      /transactions are not supported/i.test(message) ||
      codeName === 'IllegalOperation' ||
      codeName === 'NotImplemented'
    );
  }

  /** Lazily-detected: does the connected Mongo topology support transactions? */
  private transactionsSupported?: boolean;

  /** Insert user + profile within a transaction session. */
  private async insertUserAndProfile(
    dto: RegisterDto & { email: string },
    passwordHash: string,
    birthDate: Date,
    acceptedAt: Date,
    session: ClientSession,
  ): Promise<{ userId: string; role: AuthUser['role']; isPremium: boolean }> {
    const user = await this.usersService.createUser(
      {
        email: dto.email,
        passwordHash,
        acceptedTermsAt: acceptedAt,
        acceptedPrivacyAt: acceptedAt,
      },
      session,
    );
    await this.insertProfile(user._id.toString(), dto, birthDate, session);
    return { userId: user._id.toString(), role: user.role, isPremium: false };
  }

  /**
   * Create the profile row. Uses the directly-injected `Profile` model (the
   * shared schema is imported read-only from the profiles module) so
   * registration owns the atomic write rather than depending on a
   * ProfilesService transaction contract.
   */
  private async insertProfile(
    userId: string,
    dto: RegisterDto,
    birthDate: Date,
    session?: ClientSession,
  ): Promise<void> {
    await this.profileModel.create(
      [
        {
          userId: new Types.ObjectId(userId),
          nickname: dto.nickname,
          gender: dto.gender,
          birthDate,
          // Country is optional at registration (the picker was removed). Store
          // `null` when the client omits it — the Profile schema treats it as
          // "no region set" and matchmaking handles an absent country gracefully.
          country: dto.country ?? null,
          languages: dto.locale ? [dto.locale] : [],
          badges: [],
          isPremium: false,
          premiumUntil: null,
          profileViews: 0,
          avatarUrl: null,
          status: null,
        },
      ],
      session ? { session } : {},
    );
  }

  /** Map a duplicate-key (email or nickname) into a 409, else rethrow. */
  private translateCreationError(err: unknown): Error {
    if (isDuplicateKeyError(err)) {
      const keyPattern = (err as { keyPattern?: Record<string, unknown> }).keyPattern;
      if (keyPattern && 'nickname' in keyPattern) {
        return new ConflictException('Nickname already taken');
      }
      return new ConflictException('Email already registered');
    }
    return err instanceof Error ? err : new Error('Registration failed');
  }

  // ── Login ───────────────────────────────────────────────────────────────

  /**
   * Verify credentials (argon2) and, on success, issue a fresh token pair +
   * refresh session. A bad email and a bad password yield the SAME generic
   * error to avoid user enumeration, and we still run an argon2 verify against a
   * dummy hash on the missing-user path to flatten timing differences.
   */
  async login(dto: LoginDto, ctx: SessionContext = {}): Promise<AuthResponse> {
    const email = dto.email.toLowerCase();
    this.assertNotLocked(email);

    // Ban-evasion gate: a device/IP tied to an active ban may not log in at all
    // (catches a banned user signing into a different, not-yet-banned account
    // from the same machine). Fails OPEN on storage errors.
    //
    // This is a DEVICE/network gate, NOT an account ban — give it a distinct
    // 403 shape (`deviceBlocked: true`, and crucially NO `banned: true`) so the
    // client does not misread it as "this account is banned" and route the user
    // into the appeal flow (which would be a dead end — there is no account ban
    // to appeal here). The account-ban 403 below carries `banned: true`.
    if (await this.fingerprintService.isBanned(ctx)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Login is not allowed from this device or network',
        deviceBlocked: true,
      });
    }

    const user = await this.usersService.findByEmailWithSecret(email);

    if (!user) {
      // Equalise timing: verify against a throwaway hash, then fail uniformly.
      await argon2
        .verify(
          '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$3g2Z1Z1Z1Z1Z1Z1Z1Z1Z1Z1Z1Z1Z1Z1Z1Z1Z1Z1Z',
          dto.password,
        )
        .catch(() => false);
      this.registerFailedAttempt(email);
      throw new UnauthorizedException('Invalid email or password');
    }

    const ok = await argon2.verify(user.passwordHash, dto.password).catch(() => false);
    if (!ok) {
      this.registerFailedAttempt(email);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.isBanned) {
      // 403 (not 401) carrying the ban REASON so the client can explain WHY the
      // account is blocked and offer the appeal flow. The body is a structured
      // object (`{ statusCode, message, error, banned, banReason }`); `banned:
      // true` is the DISCRIMINATOR the client matches on to distinguish a real
      // ACCOUNT ban (appealable) from the device/network gate above (which is a
      // 403 too, but carries `deviceBlocked` and no `banned`). `banReason` is
      // `null` for legacy bans recorded before reasons were captured. Surfaced
      // only here (the user-facing login), not on the background refresh paths.
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Account is banned',
        banned: true,
        banReason: user.banReason ?? null,
      });
    }

    this.clearFailedAttempts(email);

    const isPremium = await this.resolveIsPremium(user._id.toString());
    const authUser: AuthUser = {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      nickname: await this.resolveNickname(user._id.toString()),
      isPremium,
      emailVerified: user.emailVerified ?? false,
    };
    const tokens = await this.issueSession(
      { sub: user._id.toString(), role: user.role, isPremium },
      randomUUID(),
      ctx,
    );
    return { user: authUser, tokens };
  }

  // ── Refresh (rotation + reuse detection) ───────────────────────────────────

  /**
   * Verify and ROTATE a refresh token. The presented token must (a) verify
   * against `JWT_REFRESH_SECRET`, and (b) map to a live session row. On a valid
   * rotation we mark the old row replaced and mint a successor in the same
   * family. If the row is missing, already replaced, or revoked — i.e. a
   * replayed/leaked token — we revoke the ENTIRE family and reject.
   */
  async refresh(refreshToken: string, ctx: SessionContext = {}): Promise<AuthResponse> {
    const payload = await this.verifyRefreshToken(refreshToken);
    const tokenHash = this.hashToken(refreshToken);

    const existing = await this.sessionModel.findOne({ tokenHash }).exec();

    // Token verified by signature but absent from the store → already rotated
    // out and pruned, or forged session id. Revoke the family defensively.
    if (!existing) {
      await this.revokeFamily(payload.family);
      throw new UnauthorizedException('Invalid refresh token');
    }

    // A token we EXPLICITLY revoked (logout / reuse-burn / password reset) is a
    // hard signal — never within grace. Burn the family.
    if (existing.revokedAt !== null) {
      await this.revokeFamily(existing.family);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    // ROTATION GRACE: the token was already rotated out, but only just now and
    // it was not revoked → this is a benign concurrent/double refresh (two tabs,
    // or a reload racing an open tab presenting the same cookie). Re-issue
    // idempotently against the family instead of burning it. A replay LONG after
    // rotation falls through to genuine reuse detection below.
    if (existing.replacedByHash !== null) {
      if (this.isWithinRotationGrace(existing.replacedAt)) {
        return this.reissueWithinGrace(existing.family, existing.userId.toString(), ctx);
      }
      // Stale replay of a long-since-rotated token → compromise. Burn the family.
      await this.revokeFamily(existing.family);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Re-resolve live authorization claims so a refresh reflects role/premium
    // changes and immediately rejects a since-banned account.
    const user = await this.usersService.findById(existing.userId.toString());
    if (!user) {
      await this.revokeFamily(existing.family);
      throw new UnauthorizedException('Account no longer exists');
    }
    if (user.isBanned) {
      await this.revokeFamily(existing.family);
      throw new UnauthorizedException('Account is banned');
    }

    const isPremium = await this.resolveIsPremium(user._id.toString());
    const userId = user._id.toString();

    // Mint the successor, then atomically link the old row to it. The compare
    // on `replacedByHash: null` makes concurrent rotations of the same token
    // race-safe: only one wins; the loser is caught here as `modifiedCount !== 1`.
    const tokens = await this.issueSession(
      { sub: userId, role: user.role, isPremium },
      existing.family,
      ctx,
    );
    const linked = await this.sessionModel
      .updateOne(
        { tokenHash, replacedByHash: null, revokedAt: null },
        { $set: { replacedByHash: this.hashToken(tokens.refreshToken), replacedAt: new Date() } },
      )
      .exec();

    if (linked.modifiedCount !== 1) {
      // Lost a concurrent rotation race. Re-read the row: if the WINNER replaced
      // it just now (within grace) and it was not revoked, this is the same
      // benign double refresh — re-issue idempotently rather than burning the
      // family. (We already minted `tokens` above; that orphan row simply ages
      // out via the TTL index — it is never handed to the caller.) Only a row
      // that is revoked, or replaced long ago, is genuine reuse.
      const current = await this.sessionModel.findOne({ tokenHash }).exec();
      if (
        current &&
        current.revokedAt === null &&
        current.replacedByHash !== null &&
        this.isWithinRotationGrace(current.replacedAt)
      ) {
        return this.reissueWithinGrace(existing.family, userId, ctx);
      }
      await this.revokeFamily(existing.family);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    const authUser: AuthUser = {
      id: userId,
      email: user.email,
      role: user.role,
      nickname: await this.resolveNickname(userId),
      isPremium,
      emailVerified: user.emailVerified ?? false,
    };
    return { user: authUser, tokens };
  }

  /** True when a row was rotated out within the rotation-grace window. */
  private isWithinRotationGrace(replacedAt: Date | null | undefined): boolean {
    if (!replacedAt) return false;
    return Date.now() - replacedAt.getTime() <= ROTATION_GRACE_MS;
  }

  /**
   * Idempotently re-issue a fresh token pair in `family` for a benign within-grace
   * duplicate refresh (concurrent tabs / reload race). Re-resolves live auth
   * claims (so a since-banned account is still rejected) and mints a new session
   * row in the SAME family WITHOUT revoking it. The genuine-reuse / stale-replay
   * paths are handled by the caller; this is only reached inside the grace window.
   */
  private async reissueWithinGrace(
    family: string,
    userId: string,
    ctx: SessionContext,
  ): Promise<AuthResponse> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      await this.revokeFamily(family);
      throw new UnauthorizedException('Account no longer exists');
    }
    if (user.isBanned) {
      await this.revokeFamily(family);
      throw new UnauthorizedException('Account is banned');
    }

    const isPremium = await this.resolveIsPremium(user._id.toString());
    const resolvedId = user._id.toString();
    const tokens = await this.issueSession(
      { sub: resolvedId, role: user.role, isPremium },
      family,
      ctx,
    );
    const authUser: AuthUser = {
      id: resolvedId,
      email: user.email,
      role: user.role,
      nickname: await this.resolveNickname(resolvedId),
      isPremium,
      emailVerified: user.emailVerified ?? false,
    };
    return { user: authUser, tokens };
  }

  // ── Logout ────────────────────────────────────────────────────────────────

  /**
   * Log the caller out.
   *
   * - A refresh token IS presented and maps to one of the caller's sessions →
   *   revoke just THAT token's rotation family (scoped, single-device logout).
   * - A refresh token is presented but is unknown, or belongs to someone else →
   *   NO-OP. We deliberately do NOT revoke all of the caller's sessions here:
   *   honouring a stale/foreign token by nuking every live session would let a
   *   replayed token force-log-out a victim everywhere. (LOW finding: scope
   *   logout to the presented refresh family.)
   * - NO refresh token at all → explicit "log out everywhere": revoke every
   *   live session for the user.
   *
   * Idempotent and never throws on an unknown/expired token.
   */
  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      const tokenHash = this.hashToken(refreshToken);
      const session = await this.sessionModel.findOne({ tokenHash }).exec();
      if (session && session.userId.toString() === userId) {
        await this.revokeFamily(session.family);
      }
      // Unknown or foreign token → no-op (do not revoke the caller's sessions).
      return;
    }
    // No token supplied → revoke every live session for the user.
    await this.revokeAllSessions(userId);
  }

  /**
   * Revoke ALL of a user's live refresh sessions (logout-everywhere). Exposed
   * for cross-module use — notably the moderation BAN flow, which must
   * immediately invalidate every refresh family of the banned account so a
   * stolen/long-lived refresh token cannot mint new access tokens. Idempotent.
   */
  async revokeAllSessions(userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      return;
    }
    await this.sessionModel
      .updateMany(
        { userId: new Types.ObjectId(userId), revokedAt: null },
        { $set: { revokedAt: new Date() } },
      )
      .exec();
  }

  // ── Active sessions / devices (self-service review + revoke) ───────────────

  /**
   * List the caller's ACTIVE logins for the settings "devices" surface.
   *
   * Each issued refresh token is its own row, but rotation keeps every row of
   * one login under a shared `family`; from the user's perspective that family
   * IS one device/login. We therefore collapse the live (un-revoked, unexpired)
   * rows by `family`, exposing per-family: the FIRST sign-in (`createdAt`, oldest
   * row) and the LAST activity (`lastActiveAt`, newest rotation), plus the
   * best-effort `ip`/`userAgent`/`device` captured at sign-in.
   *
   * `currentRefreshToken` (read from the caller's refresh COOKIE) is used only
   * to flag which family is the requesting device — never logged or returned.
   * Results are newest-active first so the current device tends to sort to top.
   */
  async listSessions(userId: string, currentRefreshToken?: string): Promise<AuthSession[]> {
    if (!Types.ObjectId.isValid(userId)) {
      return [];
    }

    const currentFamily = await this.resolveCurrentFamily(userId, currentRefreshToken);

    const rows = await this.sessionModel
      .find({
        userId: new Types.ObjectId(userId),
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      })
      .select('family ip userAgent device createdAt updatedAt')
      .lean()
      .exec();

    // Collapse rotation rows into one entry per family (one logical login).
    const byFamily = new Map<
      string,
      {
        ip: string | null;
        userAgent: string | null;
        device: string | null;
        createdAt: Date;
        lastActiveAt: Date;
      }
    >();

    for (const row of rows) {
      const family = row.family;
      // `timestamps: true` guarantees createdAt/updatedAt; fall back defensively.
      const createdAt = (row as { createdAt?: Date }).createdAt ?? new Date();
      const updatedAt = (row as { updatedAt?: Date }).updatedAt ?? createdAt;
      const existing = byFamily.get(family);
      if (!existing) {
        byFamily.set(family, {
          ip: row.ip ?? null,
          userAgent: row.userAgent ?? null,
          device: row.device ?? null,
          createdAt,
          lastActiveAt: updatedAt,
        });
        continue;
      }
      // Oldest row wins for first-seen context + createdAt; newest for activity.
      if (createdAt.getTime() < existing.createdAt.getTime()) {
        existing.createdAt = createdAt;
        existing.ip = row.ip ?? existing.ip;
        existing.userAgent = row.userAgent ?? existing.userAgent;
        existing.device = row.device ?? existing.device;
      }
      if (updatedAt.getTime() > existing.lastActiveAt.getTime()) {
        existing.lastActiveAt = updatedAt;
      }
    }

    return Array.from(byFamily.entries())
      .map(([family, agg]) => ({
        id: family,
        ip: agg.ip,
        userAgent: agg.userAgent,
        device: agg.device,
        createdAt: agg.createdAt.toISOString(),
        lastActiveAt: agg.lastActiveAt.toISOString(),
        current: currentFamily !== null && family === currentFamily,
      }))
      .sort((a, b) => {
        // Current device first, then most-recently-active.
        if (a.current !== b.current) return a.current ? -1 : 1;
        return b.lastActiveAt.localeCompare(a.lastActiveAt);
      });
  }

  /**
   * Revoke ONE of the caller's logins by its `sessionId` (a rotation-family id
   * from {@link listSessions}). Scoped to the owner: the userId is part of the
   * filter, so a forged/foreign family id revokes nothing. Idempotent — a stale
   * or already-revoked id simply matches no live rows. Returns whether anything
   * was revoked so the controller can 404 a stranger/unknown id.
   */
  async revokeSession(userId: string, sessionId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId) || !sessionId) {
      return false;
    }
    const result = await this.sessionModel
      .updateMany(
        { userId: new Types.ObjectId(userId), family: sessionId, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      )
      .exec();
    return result.modifiedCount > 0;
  }

  /**
   * Revoke every OTHER live login of the caller, keeping only the family of the
   * presented `currentRefreshToken` (the requesting device's cookie) alive —
   * "sign out everywhere else".
   *
   * The cookie is meant to PROTECT the current device. So when a cookie IS
   * presented but its family cannot be resolved (stale/rotated/foreign token),
   * we must NOT silently fall back to revoking EVERYTHING — that would nuke the
   * very device performing the action, the exact opposite of what the user
   * asked for, surfacing as a surprise "session expired" on the current device.
   * In that case we revoke nothing and let the caller (controller) treat it as a
   * no-op / soft failure rather than claim the current device survived.
   *
   * Only when NO cookie was presented at all (`currentRefreshToken` is
   * empty/absent) do we behave like a true "log out everywhere" and revoke all
   * live sessions. Returns whether the current family was resolved, so the
   * caller can avoid optimistically asserting the current device survived. Idempotent.
   */
  async revokeOtherSessions(
    userId: string,
    currentRefreshToken?: string,
  ): Promise<{ currentPreserved: boolean }> {
    if (!Types.ObjectId.isValid(userId)) {
      return { currentPreserved: false };
    }

    const filter: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
      revokedAt: null,
    };

    if (currentRefreshToken) {
      const currentFamily = await this.resolveCurrentFamily(userId, currentRefreshToken);
      if (currentFamily === null) {
        // A cookie was presented but maps to no live family. Do NOT fall back to
        // revoke-ALL (that would log the caller out of the device they're on).
        // Revoke nothing and report that the current device was not preserved.
        return { currentPreserved: false };
      }
      filter.family = { $ne: currentFamily };
      await this.sessionModel.updateMany(filter, { $set: { revokedAt: new Date() } }).exec();
      return { currentPreserved: true };
    }

    // No cookie at all → true "log out everywhere": revoke every live session.
    await this.sessionModel.updateMany(filter, { $set: { revokedAt: new Date() } }).exec();
    return { currentPreserved: false };
  }

  /**
   * True when `sessionId` (a rotation-family id) is the family of the caller's
   * presented `currentRefreshToken` — i.e. the caller is revoking their OWN
   * current device. Lets the controller clear the refresh cookie in that case.
   */
  async isCurrentSession(
    userId: string,
    sessionId: string,
    currentRefreshToken: string,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId) || !sessionId) {
      return false;
    }
    const currentFamily = await this.resolveCurrentFamily(userId, currentRefreshToken);
    return currentFamily !== null && currentFamily === sessionId;
  }

  /**
   * Resolve the rotation `family` of the caller's CURRENT refresh token (from
   * the cookie), or `null` when no token is supplied or it maps to no live row
   * owned by the user. Used to flag/protect the requesting device. Verifying the
   * signature is unnecessary here — we only ever match the hash against the
   * user's own live rows, so a garbage value simply resolves to `null`.
   */
  private async resolveCurrentFamily(
    userId: string,
    currentRefreshToken?: string,
  ): Promise<string | null> {
    if (!currentRefreshToken) {
      return null;
    }
    const row = await this.sessionModel
      .findOne({
        userId: new Types.ObjectId(userId),
        tokenHash: this.hashToken(currentRefreshToken),
      })
      .select('family')
      .lean()
      .exec();
    return row?.family ?? null;
  }

  // ── /me ─────────────────────────────────────────────────────────────────

  /**
   * Resolve the {@link AuthUser} view for an already-authenticated caller (from
   * the access-token payload). Throws `401` if the account vanished.
   */
  async getAuthUser(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }
    const isPremium = await this.resolveIsPremium(user._id.toString());
    return {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      nickname: await this.resolveNickname(user._id.toString()),
      isPremium,
      emailVerified: user.emailVerified ?? false,
    };
  }

  // ── Email verification + password reset (token-based, emailed link) ────────

  /**
   * Mint a fresh single-use email-verification token and send the verify email
   * (best-effort). Outstanding `email_verify` tokens for the user are first
   * invalidated so only the newest link works. NEVER throws — used on the
   * registration happy-path (a mail outage must not fail signup) and by
   * {@link resendVerification}.
   */
  async requestEmailVerification(userId: string, email: string): Promise<void> {
    try {
      const token = await this.mintToken(userId, 'email_verify', EMAIL_VERIFY_TTL_MS);
      await this.mailerService.sendVerificationEmail(email, token);
    } catch (err) {
      this.logger.warn(
        `Failed to issue verification email for ${userId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Consume an `email_verify` token: validate it is live (exists, unconsumed,
   * unexpired), atomically mark it consumed (so it is single-use even under
   * concurrent submits), then flip the account's `emailVerified` flag. Throws
   * `400` on a missing/expired/already-used token.
   */
  async verifyEmail(token: string): Promise<void> {
    const consumed = await this.consumeToken(token, 'email_verify');
    if (!consumed) {
      throw new BadRequestException('Invalid or expired verification token');
    }
    await this.usersService.markEmailVerified(consumed.userId.toString());
  }

  /**
   * Re-send the verification email for an already-authenticated caller
   * (rate-limited at the controller). Idempotent no-op (still 204) if the
   * account is already verified or vanished — never reveals state and never
   * throws on a mail outage.
   */
  async resendVerification(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user || user.emailVerified) {
      return;
    }
    await this.requestEmailVerification(userId, user.email);
  }

  /**
   * Begin a password reset. ALWAYS resolves without revealing whether the email
   * exists (anti-enumeration): if an active account is found we mint a 1h
   * single-use reset token and send the email (best-effort); otherwise we do
   * nothing. The controller returns 204 regardless.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email.toLowerCase());
    // Do not leak existence: a missing (or already-erased) account → silent no-op.
    if (!user || user.deletedAt) {
      return;
    }
    try {
      const token = await this.mintToken(
        user._id.toString(),
        'password_reset',
        PASSWORD_RESET_TTL_MS,
      );
      await this.mailerService.sendPasswordResetEmail(user.email, token);
    } catch (err) {
      this.logger.warn(
        `Failed to issue password-reset email: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Complete a password reset: validate + consume the `password_reset` token,
   * reject the most-breached passwords (same floor as registration), hash the
   * new password (argon2id), persist it, and REVOKE ALL of the user's refresh
   * sessions so any stolen session dies with the old password. Throws `400` on
   * a bad/expired/used token.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    this.assertPasswordAcceptable(newPassword);

    const consumed = await this.consumeToken(token, 'password_reset');
    if (!consumed) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const userId = consumed.userId.toString();
    const passwordHash = await argon2.hash(newPassword, ARGON2_OPTIONS);
    const updated = await this.usersService.updatePasswordHash(userId, passwordHash);
    if (!updated) {
      // Token was valid but the account is gone/erased — nothing to reset.
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Kill every live refresh family so the old credential's sessions can't
    // outlive the change (defends a reset triggered by account takeover).
    await this.revokeAllSessions(userId);
    this.logger.log(`Password reset completed for ${userId}; all sessions revoked.`);
  }

  /**
   * Change the password of an ALREADY-authenticated caller who supplies their
   * CURRENT password (distinct from the emailed-token {@link resetPassword}
   * flow). Verifies `currentPassword` against the stored argon2 hash, enforces
   * the same breached-password floor as registration on `newPassword`, hashes +
   * persists the new credential, then REVOKES ALL of the user's refresh sessions
   * so every other device is logged out (the caller re-authenticates with the
   * new password). Throws `401` if the current password is wrong, `400` if the
   * new password is unacceptable or equals the current one.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    ctx: SessionContext = {},
  ): Promise<void> {
    // Load the credential row WITH the hash (same select-the-secret path login
    // uses, by id) so we can verify the supplied current password.
    const user = await this.usersService.findByIdWithSecret(userId);
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }

    const currentOk = await argon2
      .verify(user.passwordHash, dto.currentPassword)
      .catch(() => false);
    if (!currentOk) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    // Reject a no-op change so a user isn't logged out of every device for
    // nothing (and to nudge them toward an actually-different secret).
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException('New password must be different from the current password');
    }

    // Same breached-password floor as registration (length/strength is already
    // enforced by the shared `passwordSchema` at the controller boundary).
    this.assertPasswordAcceptable(dto.newPassword);

    const passwordHash = await argon2.hash(dto.newPassword, ARGON2_OPTIONS);
    const updated = await this.usersService.updatePasswordHash(userId, passwordHash);
    if (!updated) {
      // The account was erased between the read above and the write.
      throw new UnauthorizedException('Account no longer exists');
    }

    // Log every other device out: a password change must not leave a stolen
    // session alive (mirrors the reset flow's session-revoke hook).
    await this.revokeAllSessions(userId);
    this.logger.log(
      `Password changed for ${userId}; all sessions revoked${ctx.ip ? ` (from ${ctx.ip})` : ''}.`,
    );
  }

  // ── Verification-token helpers ─────────────────────────────────────────────

  /**
   * Mint a single-use token of `purpose`: generate high-entropy random bytes,
   * persist ONLY their SHA-256 hash with the given TTL, and return the RAW
   * token for the emailed link. Older live tokens of the same purpose for this
   * user are invalidated first so only the newest link works.
   */
  private async mintToken(
    userId: string,
    purpose: VerificationTokenPurpose,
    ttlMs: number,
  ): Promise<string> {
    const objectId = new Types.ObjectId(userId);
    // Supersede any outstanding tokens of this purpose (consume them now).
    await this.verificationTokenModel
      .updateMany(
        { userId: objectId, purpose, consumedAt: null },
        { $set: { consumedAt: new Date() } },
      )
      .exec();

    const rawToken = randomBytes(TOKEN_BYTES).toString('hex');
    await this.verificationTokenModel.create({
      userId: objectId,
      tokenHash: this.hashToken(rawToken),
      purpose,
      expiresAt: new Date(Date.now() + ttlMs),
      consumedAt: null,
    });
    return rawToken;
  }

  /**
   * Atomically consume a token: find a row matching the hash + purpose that is
   * still live (unconsumed, unexpired) and stamp `consumedAt` in one
   * compare-and-set, so a token can be redeemed at most once even under a
   * double-submit. Returns the matched row (for its `userId`) or `null` when no
   * live token matched.
   */
  private async consumeToken(
    rawToken: string,
    purpose: VerificationTokenPurpose,
  ): Promise<VerificationTokenDocument | null> {
    const tokenHash = this.hashToken(rawToken);
    return this.verificationTokenModel
      .findOneAndUpdate(
        {
          tokenHash,
          purpose,
          consumedAt: null,
          expiresAt: { $gt: new Date() },
        },
        { $set: { consumedAt: new Date() } },
        { new: false },
      )
      .exec();
  }

  // ── Token / session helpers ─────────────────────────────────────────────

  /**
   * Sign an access+refresh pair for `claims`, persist the refresh session row
   * (hash only) under `family`, and return the plaintext tokens. Used by
   * register, login and refresh (rotation reuses the existing family).
   */
  private async issueSession(
    claims: JwtPayload,
    family: string,
    ctx: SessionContext,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = await this.jwtService.signAsync(claims);

    const jti = randomUUID();
    const refreshPayload: RefreshTokenPayload = { ...claims, family, jti };
    const refreshSecret = this.getRequired('JWT_REFRESH_SECRET');
    // ConfigService yields a string; jsonwebtoken types `expiresIn` as the
    // narrow ms.StringValue | number. A valid ms string ('30d', '900s') is
    // correct at runtime, so assert it to the library's expected type (mirrors
    // the cast in CommonModule's access-token JwtModule config).
    const refreshTtl = this.configService.get<string>('JWT_REFRESH_TTL', '30d') as NonNullable<
      JwtSignOptions['expiresIn']
    >;
    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      secret: refreshSecret,
      expiresIn: refreshTtl,
      // Pin the signing algorithm (the refresh secret is a symmetric key).
      algorithm: 'HS256',
    });

    await this.sessionModel.create({
      userId: new Types.ObjectId(claims.sub),
      tokenHash: this.hashToken(refreshToken),
      family,
      expiresAt: this.refreshExpiryDate(refreshToken),
      replacedByHash: null,
      replacedAt: null,
      revokedAt: null,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      device: null,
    });

    return { accessToken, refreshToken };
  }

  /** Verify a refresh token's signature/expiry against the refresh secret. */
  private async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    try {
      return await this.jwtService.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.getRequired('JWT_REFRESH_SECRET'),
        // Only accept HS256-signed refresh tokens (defence against `alg: none`
        // / algorithm-confusion forgeries).
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  /** Revoke (soft) every live row in a rotation family. */
  private async revokeFamily(family: string): Promise<void> {
    await this.sessionModel
      .updateMany({ family, revokedAt: null }, { $set: { revokedAt: new Date() } })
      .exec();
  }

  /** SHA-256 hex digest — we persist this, never the raw refresh token. */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Absolute expiry of a signed refresh token, derived from its `exp` claim. */
  private refreshExpiryDate(token: string): Date {
    const decoded = this.jwtService.decode<{ exp?: number } | null>(token);
    if (decoded?.exp) {
      return new Date(decoded.exp * 1000);
    }
    // Defensive fallback if the token carries no exp (should not happen).
    return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }

  // ── Cross-module read helpers (Profile denormalised data) ─────────────────

  /** Read the denormalised premium flag from the user's profile (false-safe). */
  private async resolveIsPremium(userId: string): Promise<boolean> {
    const profile = await this.profileModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .select('isPremium')
      .lean()
      .exec();
    return profile?.isPremium ?? false;
  }

  /** Read the user's nickname from their profile, or '' if absent. */
  private async resolveNickname(userId: string): Promise<string> {
    const profile = await this.profileModel
      .findOne({ userId: new Types.ObjectId(userId) })
      .select('nickname')
      .lean()
      .exec();
    return profile?.nickname ?? '';
  }

  // ── Brute-force counters ─────────────────────────────────────────────────

  /** Reject early if the email is currently locked out. */
  private assertNotLocked(email: string): void {
    const state = this.loginAttempts.get(email);
    if (state?.lockedUntil && state.lockedUntil > Date.now()) {
      throw new UnauthorizedException('Too many failed attempts. Try again later.');
    }
  }

  /** Increment the failed-login counter and lock the email past the threshold. */
  private registerFailedAttempt(email: string): void {
    const state = this.loginAttempts.get(email) ?? { count: 0, lockedUntil: null };
    state.count += 1;
    if (state.count >= MAX_LOGIN_ATTEMPTS) {
      state.lockedUntil = Date.now() + LOGIN_LOCK_MS;
      state.count = 0;
      this.logger.warn(`Login lockout engaged for ${email}`);
    }
    this.loginAttempts.set(email, state);
  }

  /** Clear the failed-login counter after a successful login. */
  private clearFailedAttempts(email: string): void {
    this.loginAttempts.delete(email);
  }

  // ── Misc ──────────────────────────────────────────────────────────────────

  /**
   * Reject the most-breached passwords (length is already enforced by the zod
   * `passwordSchema`). Case-insensitive. Throws `400` so the client can prompt
   * for a stronger password.
   */
  private assertPasswordAcceptable(password: string): void {
    if (TOP_COMMON_PASSWORDS.has(password.toLowerCase())) {
      throw new BadRequestException('This password is too common. Please choose a stronger one.');
    }
  }

  /** Parse `yyyy-mm-dd`, throwing a 400 on an unparseable date. */
  private parseBirthDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid birthDate');
    }
    return date;
  }

  /** Whole-year age from a date of birth (UTC), relative to now. */
  private computeAge(birthDate: Date, now: Date = new Date()): number {
    let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
    const monthDelta = now.getUTCMonth() - birthDate.getUTCMonth();
    if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < birthDate.getUTCDate())) {
      age -= 1;
    }
    return age;
  }

  /** Start a Mongo session, returning `null` if transactions are unsupported. */
  private async startSessionOrNull(): Promise<ClientSession | null> {
    try {
      return await this.connection.startSession();
    } catch {
      return null;
    }
  }

  /** Read a required env var or throw a clear startup-time-ish error. */
  private getRequired(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new Error(`${key} is not configured`);
    }
    return value;
  }
}
