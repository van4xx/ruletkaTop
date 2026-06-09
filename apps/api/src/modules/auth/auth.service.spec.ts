import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import type { Connection } from 'mongoose';

import type { LoginDto, RegisterDto } from '@ruletka/shared-types';

import type { UsersService } from '../users/users.service';
import { AuthService, type SessionContext } from './auth.service';

/**
 * AuthService unit tests.
 *
 * Style mirrors `wallet.service.spec.ts`: everything external is mocked and no
 * database is required. AuthService has six collaborators, so rather than wire
 * a Nest testing module we instantiate the service directly with typed mocks —
 * the second instantiation style the project's testing rules explicitly allow
 * — which gives precise per-test control over the Mongo session/transaction
 * behaviour we need to exercise (transaction success vs. the standalone-Mongo
 * fallback path).
 *
 * argon2 is used FOR REAL (it is a dependency of the API): the register
 * happy-path proves the stored hash is not the plaintext and that
 * `argon2.verify` accepts the original password against it. Hashing is the
 * only slow operation, so the suite raises Jest's timeout modestly.
 */
jest.setTimeout(30_000);

// ── Test fixtures ────────────────────────────────────────────────────────────

const USER_ID = '507f1f77bcf86cd799439011';
const PLAINTEXT_PASSWORD = 'sup3r-secret-pw';

/** A birthDate `years` before now as `yyyy-mm-dd` (never goes stale). */
function birthDateYearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

function makeRegisterDto(overrides: Partial<RegisterDto> = {}): RegisterDto {
  return {
    email: 'New.User@Example.com',
    password: PLAINTEXT_PASSWORD,
    nickname: 'newuser',
    gender: 'male',
    birthDate: birthDateYearsAgo(25),
    country: 'US',
    locale: 'en',
    // Consent is required by the service; the happy path accepts the terms.
    acceptedTerms: true,
    ...overrides,
  };
}

/** SHA-256 hex, matching AuthService's private `hashToken`. */
function sha256(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A `findOne().exec()` style chainable returning `result`. */
function findOneReturning(result: unknown): { exec: jest.Mock } {
  return { exec: jest.fn().mockResolvedValue(result) };
}

/** A fake `UserDocument`-ish object (only the fields AuthService touches). */
function fakeUser(overrides: Record<string, unknown> = {}) {
  return {
    _id: { toString: () => USER_ID },
    email: 'new.user@example.com',
    role: 'user' as const,
    isBanned: false,
    emailVerified: false,
    deletedAt: null,
    ...overrides,
  };
}

// ── Mock builders ────────────────────────────────────────────────────────────

interface Mocks {
  usersService: jest.Mocked<
    Pick<
      UsersService,
      | 'findByEmail'
      | 'findByEmailWithSecret'
      | 'findById'
      | 'findByIdWithSecret'
      | 'createUser'
      | 'markEmailVerified'
      | 'updatePasswordHash'
    >
  >;
  jwtService: {
    signAsync: jest.Mock;
    verifyAsync: jest.Mock;
    decode: jest.Mock;
  };
  configService: { get: jest.Mock };
  captchaService: { verify: jest.Mock; isEnabled: jest.Mock };
  fingerprintService: { isBanned: jest.Mock; recordForUser: jest.Mock };
  sessionModel: {
    create: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    updateOne: jest.Mock;
    updateMany: jest.Mock;
  };
  profileModel: { create: jest.Mock; findOne: jest.Mock };
  verificationTokenModel: {
    create: jest.Mock;
    updateMany: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };
  mailerService: {
    sendVerificationEmail: jest.Mock;
    sendPasswordResetEmail: jest.Mock;
  };
  connection: {
    startSession: jest.Mock;
    collection: jest.Mock;
  };
  /**
   * Minimal in-memory fake of the shared ioredis client used by the Redis-backed
   * login lockout. Implements only the surface AuthService touches (`exists`,
   * `eval` of the attempt-counter Lua, `del`) with the same lock semantics so
   * the lockout tests exercise real cross-call state without a live Redis.
   */
  redis: {
    exists: jest.Mock;
    eval: jest.Mock;
    del: jest.Mock;
    /** Direct access to the backing store (for assertions / resets if needed). */
    store: Map<string, string>;
  };
  /** The admin live-flag store (registration / matchmaking kill-switches). */
  liveFlags: {
    isRegistrationOpen: jest.Mock;
    isMatchmakingEnabled: jest.Mock;
    isMaintenanceMode: jest.Mock;
  };
  usersCollectionDeleteOne: jest.Mock;
  /** The `withTransaction` mock of the session returned by `startSession`. */
  withTransaction: jest.Mock;
}

/**
 * Build the in-memory fake Redis. Models just enough of ioredis for the login
 * lockout: `exists(key)`, the attempt-counter `eval(lua, 2, attemptKey,
 * lockKey, ttl, max, lockTtl)` (INCR + lock-on-threshold + reset-on-lock), and
 * `del(...keys)`. TTLs are tracked as presence only (jest's fake timers are not
 * used here; the lockout-window tests assert the LOCK is engaged, not its
 * expiry, mirroring the prior in-memory behaviour).
 */
function buildFakeRedis(): Mocks['redis'] {
  const store = new Map<string, string>();
  const exists = jest.fn(async (key: string) => (store.has(key) ? 1 : 0));
  const del = jest.fn(async (...keys: string[]) => {
    let removed = 0;
    for (const key of keys) {
      if (store.delete(key)) removed += 1;
    }
    return removed;
  });
  const evalFn = jest.fn(
    async (
      _lua: string,
      _numKeys: number,
      attemptKey: string,
      lockKey: string,
      _ttl: string,
      maxAttempts: string,
      _lockTtl: string,
    ) => {
      const next = Number(store.get(attemptKey) ?? '0') + 1;
      if (next >= Number(maxAttempts)) {
        // Engage the lock and reset the counter (matches the Lua + old in-memory).
        store.set(lockKey, '1');
        store.delete(attemptKey);
      } else {
        store.set(attemptKey, String(next));
      }
      return next;
    },
  );
  return { exists, eval: evalFn, del, store };
}

/**
 * Build the mock collaborators. `transactionMode` controls what
 * `connection.startSession().withTransaction()` does:
 *  - 'commit'      → runs the callback (deployment supports transactions)
 *  - 'unsupported' → throws a "does not support retryable writes" error so the
 *                    service falls back to the sequential create path
 */
function buildMocks(transactionMode: 'commit' | 'unsupported' = 'commit'): Mocks {
  const usersService = {
    findByEmail: jest.fn().mockResolvedValue(null),
    findByEmailWithSecret: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue(null),
    findByIdWithSecret: jest.fn().mockResolvedValue(null),
    createUser: jest.fn().mockResolvedValue(fakeUser()),
    markEmailVerified: jest.fn().mockResolvedValue(true),
    updatePasswordHash: jest.fn().mockResolvedValue(true),
  } as unknown as Mocks['usersService'];

  // Sign deterministic-yet-unique tokens so every issued refresh token hashes
  // differently (the real service relies on a random jti for the same effect).
  let signCounter = 0;
  const jwtService = {
    signAsync: jest.fn().mockImplementation(async (_payload, opts) => {
      signCounter += 1;
      const kind = opts?.secret ? 'refresh' : 'access';
      return `${kind}.token.${signCounter}`;
    }),
    verifyAsync: jest.fn(),
    // Used by refreshExpiryDate — return a far-future exp.
    decode: jest.fn().mockReturnValue({
      exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    }),
  };

  const configService = {
    get: jest.fn().mockImplementation((key: string, fallback?: string) => {
      if (key === 'JWT_REFRESH_SECRET') return 'refresh-secret';
      if (key === 'JWT_REFRESH_TTL') return fallback ?? '30d';
      return fallback;
    }),
  };

  // CAPTCHA verification defaults to PASS (disabled / dev no-op); individual
  // tests override `verify` to exercise the configured-and-fails path.
  const captchaService = {
    verify: jest.fn().mockResolvedValue(true),
    isEnabled: jest.fn().mockReturnValue(false),
  };

  // Fingerprint ban check defaults to NOT banned; `recordForUser` is a no-op.
  const fingerprintService = {
    isBanned: jest.fn().mockResolvedValue(false),
    recordForUser: jest.fn().mockResolvedValue(undefined),
  };

  const sessionModel = {
    create: jest.fn().mockResolvedValue([{ _id: 'session-row' }]),
    // listSessions → .find().select().lean().exec(); default to an empty list.
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    }),
    findOne: jest.fn(),
    updateOne: jest.fn().mockReturnValue(findOneReturning({ modifiedCount: 1 })),
    updateMany: jest.fn().mockReturnValue(findOneReturning({ modifiedCount: 1 })),
  };

  const profileModel = {
    create: jest.fn().mockResolvedValue([{ _id: 'profile-row' }]),
    // resolveIsPremium / resolveNickname → .findOne().select().lean().exec()
    findOne: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue({ isPremium: false, nickname: 'newuser' }),
    }),
  };

  // Verification-token collection: mint supersedes older tokens (updateMany)
  // then creates a row; consume is an atomic findOneAndUpdate.
  const verificationTokenModel = {
    create: jest.fn().mockResolvedValue([{ _id: 'vtoken-row' }]),
    updateMany: jest.fn().mockReturnValue(findOneReturning({ modifiedCount: 0 })),
    findOneAndUpdate: jest.fn().mockReturnValue(findOneReturning(null)),
  };

  // Mailer defaults to a successful (no-op) send; never throws.
  const mailerService = {
    sendVerificationEmail: jest.fn().mockResolvedValue(true),
    sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
  };

  const usersCollectionDeleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });

  const session = {
    withTransaction: jest.fn().mockImplementation(async (cb: () => Promise<void>) => {
      if (transactionMode === 'unsupported') {
        throw Object.assign(
          new Error('This MongoDB deployment does not support retryable writes'),
          {
            codeName: 'IllegalOperation',
          },
        );
      }
      return cb();
    }),
    endSession: jest.fn().mockResolvedValue(undefined),
  };

  const connection = {
    startSession: jest.fn().mockResolvedValue(session),
    collection: jest.fn().mockReturnValue({ deleteOne: usersCollectionDeleteOne }),
  };

  const redis = buildFakeRedis();

  // Live-flag store: registration OPEN by default so the register tests exercise
  // the happy path; individual tests can flip `isRegistrationOpen` to assert the
  // kill-switch.
  const liveFlags = {
    isRegistrationOpen: jest.fn().mockResolvedValue(true),
    isMatchmakingEnabled: jest.fn().mockResolvedValue(true),
    isMaintenanceMode: jest.fn().mockResolvedValue(false),
  };

  return {
    usersService,
    jwtService,
    configService,
    captchaService,
    fingerprintService,
    sessionModel,
    profileModel,
    verificationTokenModel,
    mailerService,
    connection,
    redis,
    liveFlags,
    usersCollectionDeleteOne,
    withTransaction: session.withTransaction,
  };
}

function makeService(m: Mocks): AuthService {
  return new AuthService(
    m.usersService as unknown as UsersService,
    m.jwtService as unknown as JwtService,
    m.configService as unknown as ConfigService,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m.captchaService as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m.fingerprintService as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m.sessionModel as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m.profileModel as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m.verificationTokenModel as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m.mailerService as any,
    m.connection as unknown as Connection,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m.redis as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m.liveFlags as any,
  );
}

// ── register ─────────────────────────────────────────────────────────────────

describe('AuthService.register', () => {
  it('creates the user + profile, stores an argon2 hash (not the plaintext), and issues a token pair', async () => {
    const m = buildMocks('commit');
    const service = makeService(m);
    const dto = makeRegisterDto();

    const res = await service.register(dto, { ip: '1.2.3.4', userAgent: 'jest' });

    // User created with the lower-cased email (normalisation happens in register).
    expect(m.usersService.createUser).toHaveBeenCalledTimes(1);
    const [createUserInput] = m.usersService.createUser.mock.calls[0] as [
      { email: string; passwordHash: string },
    ];
    expect(createUserInput.email).toBe('new.user@example.com');

    // The stored credential MUST be an argon2 hash, never the plaintext, and
    // it MUST verify against the original password.
    const storedHash = createUserInput.passwordHash;
    expect(storedHash).not.toBe(PLAINTEXT_PASSWORD);
    expect(storedHash.startsWith('$argon2id$')).toBe(true);
    await expect(argon2.verify(storedHash, PLAINTEXT_PASSWORD)).resolves.toBe(true);
    await expect(argon2.verify(storedHash, 'wrong-password')).resolves.toBe(false);

    // Profile created for the new user with the supplied display fields.
    expect(m.profileModel.create).toHaveBeenCalledTimes(1);
    const [[profileDoc]] = m.profileModel.create.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(profileDoc).toMatchObject({
      nickname: 'newuser',
      gender: 'male',
      languages: ['en'],
    });

    // The committed transaction path was taken (no sequential fallback delete).
    expect(m.connection.startSession).toHaveBeenCalledTimes(1);
    expect(m.usersCollectionDeleteOne).not.toHaveBeenCalled();

    // Both tokens issued, an access + a refresh signature, and a session row persisted.
    expect(res.tokens.accessToken).toBeTruthy();
    expect(res.tokens.refreshToken).toBeTruthy();
    expect(res.tokens.accessToken).not.toBe(res.tokens.refreshToken);
    expect(m.jwtService.signAsync).toHaveBeenCalledTimes(2);
    expect(m.sessionModel.create).toHaveBeenCalledTimes(1);

    // The persisted session stores only the HASH of the refresh token + context.
    const [sessionRow] = m.sessionModel.create.mock.calls[0] as [Record<string, unknown>];
    expect(sessionRow.tokenHash).toBe(sha256(res.tokens.refreshToken));
    expect(sessionRow.tokenHash).not.toBe(res.tokens.refreshToken);
    expect(sessionRow).toMatchObject({
      replacedByHash: null,
      revokedAt: null,
      ip: '1.2.3.4',
      userAgent: 'jest',
    });

    // Returned AuthUser is correctly shaped.
    expect(res.user).toMatchObject({
      id: USER_ID,
      email: 'new.user@example.com',
      role: 'user',
      nickname: 'newuser',
      isPremium: false,
    });
  });

  it('ENFORCES the 18+ age gate: a birthDate under 18 throws BadRequestException before any write', async () => {
    const m = buildMocks('commit');
    const service = makeService(m);
    // 17 years + clearly under: 17 years ago minus a day-ish margin.
    const dto = makeRegisterDto({ birthDate: birthDateYearsAgo(17) });

    await expect(service.register(dto)).rejects.toBeInstanceOf(BadRequestException);

    // Nothing was created and no password work was done.
    expect(m.usersService.findByEmail).not.toHaveBeenCalled();
    expect(m.usersService.createUser).not.toHaveBeenCalled();
    expect(m.profileModel.create).not.toHaveBeenCalled();
  });

  it('accepts an applicant who turns exactly 18 today', async () => {
    const m = buildMocks('commit');
    const service = makeService(m);
    const dto = makeRegisterDto({ birthDate: birthDateYearsAgo(18) });

    await expect(service.register(dto)).resolves.toBeDefined();
    expect(m.usersService.createUser).toHaveBeenCalledTimes(1);
  });

  it('rejects an unparseable birthDate with BadRequestException', async () => {
    const m = buildMocks('commit');
    const service = makeService(m);
    const dto = makeRegisterDto({ birthDate: 'not-a-date' });

    await expect(service.register(dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(m.usersService.createUser).not.toHaveBeenCalled();
  });

  it('throws ConflictException when the email is already registered (pre-check)', async () => {
    const m = buildMocks('commit');
    m.usersService.findByEmail.mockResolvedValue(fakeUser() as never);
    const service = makeService(m);

    await expect(service.register(makeRegisterDto())).rejects.toBeInstanceOf(ConflictException);
    expect(m.usersService.createUser).not.toHaveBeenCalled();
  });

  it('REFUSES registration (403) when the live REGISTRATION_OPEN kill-switch is off', async () => {
    const m = buildMocks('commit');
    m.liveFlags.isRegistrationOpen.mockResolvedValue(false);
    const service = makeService(m);

    await expect(service.register(makeRegisterDto())).rejects.toBeInstanceOf(ForbiddenException);
    // The gate trips BEFORE any account work.
    expect(m.usersService.findByEmail).not.toHaveBeenCalled();
    expect(m.usersService.createUser).not.toHaveBeenCalled();
  });

  it('REJECTS registration when terms/privacy consent is not given (152-ФЗ)', async () => {
    const m = buildMocks('commit');
    const service = makeService(m);

    // Missing consent.
    await expect(
      service.register(makeRegisterDto({ acceptedTerms: undefined })),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Explicitly declined.
    await expect(
      service.register(makeRegisterDto({ acceptedTerms: false })),
    ).rejects.toBeInstanceOf(BadRequestException);

    // No account is created when consent is absent.
    expect(m.usersService.createUser).not.toHaveBeenCalled();
  });

  it('records the consent timestamps on the created user when terms are accepted', async () => {
    const m = buildMocks('commit');
    const service = makeService(m);

    await service.register(makeRegisterDto());

    const createUserInput = m.usersService.createUser.mock.calls[0]?.[0] as {
      acceptedTermsAt?: Date | null;
      acceptedPrivacyAt?: Date | null;
    };
    expect(createUserInput.acceptedTermsAt).toBeInstanceOf(Date);
    expect(createUserInput.acceptedPrivacyAt).toBeInstanceOf(Date);
  });

  it('REJECTS a top-common password (length passes but the password is breached)', async () => {
    const m = buildMocks('commit');
    const service = makeService(m);

    await expect(
      service.register(makeRegisterDto({ password: 'password123' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(m.usersService.createUser).not.toHaveBeenCalled();
  });

  it('maps a Mongo duplicate-key (11000) on user insert to ConflictException (email taken)', async () => {
    const m = buildMocks('commit');
    // Pre-check passes (race), but the insert hits the unique index.
    m.usersService.createUser.mockRejectedValue(
      Object.assign(new Error('E11000 duplicate key'), {
        code: 11000,
        keyPattern: { email: 1 },
      }),
    );
    const service = makeService(m);

    const err = await service.register(makeRegisterDto()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe('Email already registered');
  });

  it('maps a duplicate-key on the nickname index to ConflictException (nickname taken)', async () => {
    const m = buildMocks('commit');
    m.profileModel.create.mockRejectedValue(
      Object.assign(new Error('E11000 duplicate key'), {
        code: 11000,
        keyPattern: { nickname: 1 },
      }),
    );
    const service = makeService(m);

    const err = await service.register(makeRegisterDto()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe('Nickname already taken');
  });

  it('verifies the CAPTCHA token (forwarding the request IP) on the happy path', async () => {
    const m = buildMocks('commit');
    const service = makeService(m);

    await service.register(makeRegisterDto({ captchaToken: 'tok-abc' }), {
      ip: '9.9.9.9',
      userAgent: 'jest',
    });

    expect(m.captchaService.verify).toHaveBeenCalledTimes(1);
    expect(m.captchaService.verify).toHaveBeenCalledWith('tok-abc', '9.9.9.9');
  });

  it('rejects with 400 when CAPTCHA verification fails, before creating anything', async () => {
    const m = buildMocks('commit');
    // Provider configured + token rejected.
    m.captchaService.verify.mockResolvedValue(false);
    const service = makeService(m);

    await expect(
      service.register(makeRegisterDto({ captchaToken: 'bad-token' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Fail fast: no user/profile writes, and the fingerprint gate is never reached.
    expect(m.usersService.createUser).not.toHaveBeenCalled();
    expect(m.profileModel.create).not.toHaveBeenCalled();
  });

  it('rejects registration from a banned-fingerprint device/IP (ban evasion) with 403', async () => {
    const m = buildMocks('commit');
    m.fingerprintService.isBanned.mockResolvedValue(true);
    const service = makeService(m);

    const err = await service
      .register(makeRegisterDto(), { ip: '5.5.5.5', userAgent: 'evader' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(m.fingerprintService.isBanned).toHaveBeenCalledWith({
      ip: '5.5.5.5',
      userAgent: 'evader',
    });
    // Gate runs before any account creation.
    expect(m.usersService.createUser).not.toHaveBeenCalled();
  });
});

// ── register: standalone-Mongo transaction fallback ───────────────────────────

describe('AuthService.register — transaction fallback (standalone Mongo)', () => {
  it('falls back to the sequential create path when transactions are unsupported and still succeeds', async () => {
    const m = buildMocks('unsupported');
    const service = makeService(m);

    const res = await service.register(makeRegisterDto());

    // withTransaction was attempted and rejected as unsupported…
    expect(m.connection.startSession).toHaveBeenCalledTimes(1);
    expect(m.withTransaction).toHaveBeenCalledTimes(1);

    // …then the sequential path created BOTH the user and the profile.
    expect(m.usersService.createUser).toHaveBeenCalledTimes(1);
    expect(m.profileModel.create).toHaveBeenCalledTimes(1);

    // No compensating delete on the happy fallback.
    expect(m.usersCollectionDeleteOne).not.toHaveBeenCalled();

    // Tokens were still issued.
    expect(res.tokens.accessToken).toBeTruthy();
    expect(res.tokens.refreshToken).toBeTruthy();
    expect(res.user.id).toBe(USER_ID);
  });

  it('remembers transactions are unsupported and skips startSession on the NEXT register', async () => {
    const m = buildMocks('unsupported');
    const service = makeService(m);

    await service.register(makeRegisterDto());
    expect(m.connection.startSession).toHaveBeenCalledTimes(1);

    // Second registration: the cached `transactionsSupported === false` flag
    // must short-circuit the session attempt entirely.
    await service.register(makeRegisterDto({ email: 'second@example.com' }));
    expect(m.connection.startSession).toHaveBeenCalledTimes(1); // unchanged
    expect(m.usersService.createUser).toHaveBeenCalledTimes(2);
  });

  it('compensates by deleting the orphaned user when the sequential profile insert fails', async () => {
    const m = buildMocks('unsupported');
    // Profile insert blows up with a non-duplicate error AFTER the user exists.
    m.profileModel.create.mockRejectedValue(new Error('profile write failed'));
    const service = makeService(m);

    await expect(service.register(makeRegisterDto())).rejects.toThrow();

    // The orphaned credential row must be rolled back so the email is reusable.
    expect(m.connection.collection).toHaveBeenCalledWith('users');
    expect(m.usersCollectionDeleteOne).toHaveBeenCalledTimes(1);
    const [deleteFilter] = m.usersCollectionDeleteOne.mock.calls[0] as [Record<string, unknown>];
    expect(deleteFilter).toHaveProperty('_id');

    // No session should have been persisted for a failed registration.
    expect(m.sessionModel.create).not.toHaveBeenCalled();
  });

  it('still maps a duplicate nickname to ConflictException on the sequential path (after compensating)', async () => {
    const m = buildMocks('unsupported');
    m.profileModel.create.mockRejectedValue(
      Object.assign(new Error('E11000 duplicate key'), {
        code: 11000,
        keyPattern: { nickname: 1 },
      }),
    );
    const service = makeService(m);

    const err = await service.register(makeRegisterDto()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe('Nickname already taken');
    expect(m.usersCollectionDeleteOne).toHaveBeenCalledTimes(1);
  });
});

// ── login ─────────────────────────────────────────────────────────────────────

describe('AuthService.login', () => {
  const loginDto: LoginDto = { email: 'New.User@Example.com', password: PLAINTEXT_PASSWORD };

  async function userWithRealHash(
    password = PLAINTEXT_PASSWORD,
    overrides: Record<string, unknown> = {},
  ) {
    return fakeUser({ passwordHash: await argon2.hash(password), ...overrides });
  }

  it('issues a token pair for valid credentials and clears nothing-but-success state', async () => {
    const m = buildMocks('commit');
    m.usersService.findByEmailWithSecret.mockResolvedValue((await userWithRealHash()) as never);
    const service = makeService(m);

    const res = await service.login(loginDto, { ip: '9.9.9.9' });

    expect(res.tokens.accessToken).toBeTruthy();
    expect(res.tokens.refreshToken).toBeTruthy();
    // Lookup uses the normalised (lower-cased) email.
    expect(m.usersService.findByEmailWithSecret).toHaveBeenCalledWith('new.user@example.com');
    expect(m.sessionModel.create).toHaveBeenCalledTimes(1);
    expect(res.user.id).toBe(USER_ID);
  });

  it('rejects a wrong password with UnauthorizedException and issues no tokens', async () => {
    const m = buildMocks('commit');
    m.usersService.findByEmailWithSecret.mockResolvedValue((await userWithRealHash()) as never);
    const service = makeService(m);

    await expect(
      service.login({ ...loginDto, password: 'incorrect-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(m.sessionModel.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown email with the SAME generic UnauthorizedException (no enumeration)', async () => {
    const m = buildMocks('commit');
    m.usersService.findByEmailWithSecret.mockResolvedValue(null);
    const service = makeService(m);

    const err = await service.login(loginDto).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).message).toBe('Invalid email or password');
  });

  it('rejects a banned account with 403 carrying the ban reason, and issues no tokens', async () => {
    const m = buildMocks('commit');
    m.usersService.findByEmailWithSecret.mockResolvedValue(
      (await userWithRealHash(PLAINTEXT_PASSWORD, {
        isBanned: true,
        banReason: 'Upheld abuse report',
      })) as never,
    );
    const service = makeService(m);

    const err = await service.login(loginDto).catch((e: unknown) => e);
    // A banned login is a 403 (not 401) whose body carries the reason so the
    // client can explain WHY and offer the appeal flow.
    expect(err).toBeInstanceOf(ForbiddenException);
    const body = (err as ForbiddenException).getResponse() as {
      message: string;
      banned: boolean;
      banReason: string | null;
    };
    expect(body.message).toBe('Account is banned');
    // The `banned: true` DISCRIMINATOR is what the client matches on to route
    // into the (appealable) account-ban flow — distinct from the device gate.
    expect(body.banned).toBe(true);
    expect(body.banReason).toBe('Upheld abuse report');
    expect(m.sessionModel.create).not.toHaveBeenCalled();
  });

  it('a banned account with no recorded reason still 403s with banReason null', async () => {
    const m = buildMocks('commit');
    m.usersService.findByEmailWithSecret.mockResolvedValue(
      (await userWithRealHash(PLAINTEXT_PASSWORD, { isBanned: true, banReason: null })) as never,
    );
    const service = makeService(m);

    const err = await service.login(loginDto).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    const body = (err as ForbiddenException).getResponse() as { banReason: string | null };
    expect(body.banReason).toBeNull();
  });

  it('rejects login from a banned-fingerprint device/IP (ban evasion) before any credential lookup', async () => {
    const m = buildMocks('commit');
    m.fingerprintService.isBanned.mockResolvedValue(true);
    const service = makeService(m);

    const err = await service
      .login(loginDto, { ip: '5.5.5.5', userAgent: 'evader' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ForbiddenException);
    // The device/network gate carries a DISTINCT discriminator (`deviceBlocked`)
    // and crucially NO `banned: true`, so the client never routes it into the
    // dead-end account-ban appeal flow.
    const body = (err as ForbiddenException).getResponse() as {
      message: string;
      deviceBlocked?: boolean;
      banned?: boolean;
    };
    expect(body.deviceBlocked).toBe(true);
    expect(body.banned).toBeUndefined();
    // The evasion gate short-circuits before the credential lookup + session mint.
    expect(m.usersService.findByEmailWithSecret).not.toHaveBeenCalled();
    expect(m.sessionModel.create).not.toHaveBeenCalled();
  });

  it('locks the email out after MAX_LOGIN_ATTEMPTS (10) consecutive failures', async () => {
    const m = buildMocks('commit');
    m.usersService.findByEmailWithSecret.mockResolvedValue((await userWithRealHash()) as never);
    const service = makeService(m);
    const bad = { ...loginDto, password: 'incorrect-password' };

    // 10 failed attempts trip the lockout; each rejects as unauthorized.
    for (let i = 0; i < 10; i += 1) {
      await expect(service.login(bad)).rejects.toBeInstanceOf(UnauthorizedException);
    }

    // The 11th attempt — even with the CORRECT password — is refused by the
    // lockout, with the distinct "too many attempts" message, before any
    // credential lookup happens.
    m.usersService.findByEmailWithSecret.mockClear();
    const err = await service.login(loginDto).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).message).toMatch(/too many failed attempts/i);
    expect(m.usersService.findByEmailWithSecret).not.toHaveBeenCalled();
  });

  it('clearing failed attempts on success: a good login between failures resets the counter', async () => {
    const m = buildMocks('commit');
    m.usersService.findByEmailWithSecret.mockResolvedValue((await userWithRealHash()) as never);
    const service = makeService(m);
    const bad = { ...loginDto, password: 'incorrect-password' };

    // 9 failures (one short of the 10-attempt lock).
    for (let i = 0; i < 9; i += 1) {
      await expect(service.login(bad)).rejects.toBeInstanceOf(UnauthorizedException);
    }
    // A successful login resets the counter…
    await expect(service.login(loginDto)).resolves.toBeDefined();

    // …so another 9 failures still do NOT lock (would need 10 fresh failures).
    for (let i = 0; i < 9; i += 1) {
      await expect(service.login(bad)).rejects.toBeInstanceOf(UnauthorizedException);
    }
    const err = await service.login(bad).catch((e: unknown) => e);
    // 10th fresh failure: still the generic invalid-credentials message (the
    // lockout engages but the *current* attempt fails as a normal bad password).
    expect((err as UnauthorizedException).message).toBe('Invalid email or password');
  });
});

// ── refresh (rotation + reuse detection) ──────────────────────────────────────

describe('AuthService.refresh', () => {
  const ctx: SessionContext = { ip: '5.5.5.5', userAgent: 'jest' };
  const PRESENTED = 'refresh.token.presented';
  const FAMILY = 'fam-123';

  /** A live (rotatable) session row for the presented token. */
  function liveSessionRow(overrides: Record<string, unknown> = {}) {
    return {
      userId: { toString: () => USER_ID },
      family: FAMILY,
      tokenHash: sha256(PRESENTED),
      replacedByHash: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      ...overrides,
    };
  }

  it('rotates a valid token: mints a new pair and links the old row to its successor', async () => {
    const m = buildMocks('commit');
    m.jwtService.verifyAsync.mockResolvedValue({ sub: USER_ID, family: FAMILY, jti: 'j1' });
    m.sessionModel.findOne.mockReturnValue(findOneReturning(liveSessionRow()));
    m.usersService.findById.mockResolvedValue(fakeUser() as never);
    const service = makeService(m);

    const res = await service.refresh(PRESENTED, ctx);

    // A brand-new pair was issued (and persisted as a new session row).
    expect(res.tokens.accessToken).toBeTruthy();
    expect(res.tokens.refreshToken).toBeTruthy();
    expect(res.tokens.refreshToken).not.toBe(PRESENTED);
    expect(m.sessionModel.create).toHaveBeenCalledTimes(1);

    // The OLD row is atomically linked to the successor (compare-and-set on
    // replacedByHash:null so concurrent rotations can't double-spend).
    expect(m.sessionModel.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = m.sessionModel.updateOne.mock.calls[0] as [
      Record<string, unknown>,
      { $set: { replacedByHash: string } },
    ];
    expect(filter).toMatchObject({
      tokenHash: sha256(PRESENTED),
      replacedByHash: null,
      revokedAt: null,
    });
    expect(update.$set.replacedByHash).toBe(sha256(res.tokens.refreshToken));

    // The new session stays in the SAME rotation family.
    const [newRow] = m.sessionModel.create.mock.calls[0] as [{ family: string }];
    expect(newRow.family).toBe(FAMILY);
  });

  it('detects REUSE of an already-rotated token and revokes the whole family', async () => {
    const m = buildMocks('commit');
    m.jwtService.verifyAsync.mockResolvedValue({ sub: USER_ID, family: FAMILY, jti: 'j1' });
    // Row exists but was already replaced → classic replay of a rotated token.
    m.sessionModel.findOne.mockReturnValue(
      findOneReturning(liveSessionRow({ replacedByHash: 'some-successor-hash' })),
    );
    const service = makeService(m);

    const err = await service.refresh(PRESENTED, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).message).toMatch(/reuse detected/i);

    // The ENTIRE family is burned and NO new token is issued.
    expect(m.sessionModel.updateMany).toHaveBeenCalledTimes(1);
    const [familyFilter] = m.sessionModel.updateMany.mock.calls[0] as [Record<string, unknown>];
    expect(familyFilter).toMatchObject({ family: FAMILY, revokedAt: null });
    expect(m.sessionModel.create).not.toHaveBeenCalled();
  });

  it('ROTATION GRACE: a within-grace duplicate refresh (token already replaced just now, not revoked) re-issues idempotently and does NOT revoke the family', async () => {
    const m = buildMocks('commit');
    m.jwtService.verifyAsync.mockResolvedValue({ sub: USER_ID, family: FAMILY, jti: 'j1' });
    // The presented token was rotated out ONE SECOND ago (well within the 20s
    // grace) and was never explicitly revoked → a benign concurrent/double
    // refresh (two tabs, or a reload racing an open tab presenting the SAME
    // cookie), not a replay.
    m.sessionModel.findOne.mockReturnValue(
      findOneReturning(
        liveSessionRow({
          replacedByHash: 'successor-hash',
          replacedAt: new Date(Date.now() - 1_000),
        }),
      ),
    );
    m.usersService.findById.mockResolvedValue(fakeUser() as never);
    const service = makeService(m);

    const res = await service.refresh(PRESENTED, ctx);

    // A fresh pair is handed back in the SAME family — the caller stays logged in.
    expect(res.tokens.accessToken).toBeTruthy();
    expect(res.tokens.refreshToken).toBeTruthy();
    expect(res.tokens.refreshToken).not.toBe(PRESENTED);
    const [newRow] = m.sessionModel.create.mock.calls[0] as [{ family: string }];
    expect(newRow.family).toBe(FAMILY);
    // Crucially, the family is NOT burned: no family-wide revoke happened.
    expect(m.sessionModel.updateMany).not.toHaveBeenCalled();
  });

  it('detects REUSE of a token replaced LONG AGO (past the grace window) and revokes the whole family', async () => {
    const m = buildMocks('commit');
    m.jwtService.verifyAsync.mockResolvedValue({ sub: USER_ID, family: FAMILY, jti: 'j1' });
    // Same shape as the grace case, but rotated out FIVE MINUTES ago — far past
    // the grace window → a genuine replay of a long-since-rotated token.
    m.sessionModel.findOne.mockReturnValue(
      findOneReturning(
        liveSessionRow({
          replacedByHash: 'successor-hash',
          replacedAt: new Date(Date.now() - 5 * 60 * 1000),
        }),
      ),
    );
    const service = makeService(m);

    const err = await service.refresh(PRESENTED, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).message).toMatch(/reuse detected/i);

    // The ENTIRE family is burned and NO new token is issued.
    expect(m.sessionModel.updateMany).toHaveBeenCalledTimes(1);
    const [familyFilter] = m.sessionModel.updateMany.mock.calls[0] as [Record<string, unknown>];
    expect(familyFilter).toMatchObject({ family: FAMILY, revokedAt: null });
    expect(m.sessionModel.create).not.toHaveBeenCalled();
  });

  it('ROTATION GRACE: a lost link race (modifiedCount !== 1) re-issues idempotently when the winner replaced the row within grace, instead of burning the family', async () => {
    const m = buildMocks('commit');
    m.jwtService.verifyAsync.mockResolvedValue({ sub: USER_ID, family: FAMILY, jti: 'j1' });
    // First findOne (initial lookup) → a live, rotatable row. Second findOne
    // (the post-race re-read) → the SAME row but now replaced just now by the
    // winning concurrent rotation. This is the two-tab race where BOTH should
    // succeed, not log the user out.
    m.sessionModel.findOne
      .mockReturnValueOnce(findOneReturning(liveSessionRow()))
      .mockReturnValueOnce(
        findOneReturning(
          liveSessionRow({
            replacedByHash: 'winner-hash',
            replacedAt: new Date(Date.now() - 500),
          }),
        ),
      );
    m.usersService.findById.mockResolvedValue(fakeUser() as never);
    // Our compare-and-set loses the race → 0 modified.
    m.sessionModel.updateOne.mockReturnValue(findOneReturning({ modifiedCount: 0 }));
    const service = makeService(m);

    const res = await service.refresh(PRESENTED, ctx);

    // The caller still gets a valid pair in the same family; the family survives.
    expect(res.tokens.accessToken).toBeTruthy();
    expect(res.tokens.refreshToken).toBeTruthy();
    expect(m.sessionModel.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a token with a valid signature but no stored row, revoking the family defensively', async () => {
    const m = buildMocks('commit');
    m.jwtService.verifyAsync.mockResolvedValue({ sub: USER_ID, family: FAMILY, jti: 'j1' });
    m.sessionModel.findOne.mockReturnValue(findOneReturning(null));
    const service = makeService(m);

    const err = await service.refresh(PRESENTED, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).message).toBe('Invalid refresh token');
    expect(m.sessionModel.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ family: FAMILY }),
      expect.anything(),
    );
    expect(m.sessionModel.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature (verifyAsync throws) without touching the store', async () => {
    const m = buildMocks('commit');
    m.jwtService.verifyAsync.mockRejectedValue(new Error('bad signature'));
    const service = makeService(m);

    const err = await service.refresh('garbage', ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).message).toBe('Invalid refresh token');
    expect(m.sessionModel.findOne).not.toHaveBeenCalled();
    expect(m.sessionModel.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an expired (but unrevoked) session row', async () => {
    const m = buildMocks('commit');
    m.jwtService.verifyAsync.mockResolvedValue({ sub: USER_ID, family: FAMILY, jti: 'j1' });
    m.sessionModel.findOne.mockReturnValue(
      findOneReturning(liveSessionRow({ expiresAt: new Date(Date.now() - 1000) })),
    );
    const service = makeService(m);

    const err = await service.refresh(PRESENTED, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).message).toMatch(/expired/i);
    expect(m.sessionModel.create).not.toHaveBeenCalled();
  });

  it('treats a lost concurrent-rotation race (link modifiedCount !== 1) as reuse and burns the family', async () => {
    const m = buildMocks('commit');
    m.jwtService.verifyAsync.mockResolvedValue({ sub: USER_ID, family: FAMILY, jti: 'j1' });
    m.sessionModel.findOne.mockReturnValue(findOneReturning(liveSessionRow()));
    m.usersService.findById.mockResolvedValue(fakeUser() as never);
    // The compare-and-set linking the old row loses the race → 0 modified.
    m.sessionModel.updateOne.mockReturnValue(findOneReturning({ modifiedCount: 0 }));
    const service = makeService(m);

    const err = await service.refresh(PRESENTED, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).message).toMatch(/reuse detected/i);
    // The successor was minted before the link, then the family is revoked.
    expect(m.sessionModel.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ family: FAMILY }),
      expect.anything(),
    );
  });

  it('rejects (and revokes the family) when the account no longer exists', async () => {
    const m = buildMocks('commit');
    m.jwtService.verifyAsync.mockResolvedValue({ sub: USER_ID, family: FAMILY, jti: 'j1' });
    m.sessionModel.findOne.mockReturnValue(findOneReturning(liveSessionRow()));
    m.usersService.findById.mockResolvedValue(null);
    const service = makeService(m);

    const err = await service.refresh(PRESENTED, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).message).toMatch(/no longer exists/i);
    expect(m.sessionModel.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ family: FAMILY }),
      expect.anything(),
    );
    expect(m.sessionModel.create).not.toHaveBeenCalled();
  });

  it('rejects (and revokes the family) when the account was banned since issuance', async () => {
    const m = buildMocks('commit');
    m.jwtService.verifyAsync.mockResolvedValue({ sub: USER_ID, family: FAMILY, jti: 'j1' });
    m.sessionModel.findOne.mockReturnValue(findOneReturning(liveSessionRow()));
    m.usersService.findById.mockResolvedValue(fakeUser({ isBanned: true }) as never);
    const service = makeService(m);

    const err = await service.refresh(PRESENTED, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).message).toMatch(/banned/i);
    expect(m.sessionModel.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ family: FAMILY }),
      expect.anything(),
    );
    expect(m.sessionModel.create).not.toHaveBeenCalled();
  });
});

// ── logout ─────────────────────────────────────────────────────────────────────

describe('AuthService.logout', () => {
  const TOKEN = 'refresh.token.logout';
  const FAMILY = 'fam-logout';

  it('revokes only the presented token’s family when a matching session is supplied', async () => {
    const m = buildMocks('commit');
    m.sessionModel.findOne.mockReturnValue(
      findOneReturning({ userId: { toString: () => USER_ID }, family: FAMILY }),
    );
    const service = makeService(m);

    await service.logout(USER_ID, TOKEN);

    expect(m.sessionModel.findOne).toHaveBeenCalledWith({ tokenHash: sha256(TOKEN) });
    expect(m.sessionModel.updateMany).toHaveBeenCalledTimes(1);
    const [filter] = m.sessionModel.updateMany.mock.calls[0] as [Record<string, unknown>];
    expect(filter).toMatchObject({ family: FAMILY, revokedAt: null });
  });

  it('falls back to revoking ALL the user’s live sessions when no token is supplied', async () => {
    const m = buildMocks('commit');
    const service = makeService(m);

    await service.logout(USER_ID);

    expect(m.sessionModel.findOne).not.toHaveBeenCalled();
    expect(m.sessionModel.updateMany).toHaveBeenCalledTimes(1);
    const [filter, update] = m.sessionModel.updateMany.mock.calls[0] as [
      Record<string, unknown>,
      { $set: { revokedAt: Date } },
    ];
    expect(filter).toHaveProperty('userId');
    expect(filter).toMatchObject({ revokedAt: null });
    expect(update.$set.revokedAt).toBeInstanceOf(Date);
  });

  it('NO-OPs on a token that belongs to a different user (does not revoke anything)', async () => {
    const m = buildMocks('commit');
    // Session is owned by someone else.
    m.sessionModel.findOne.mockReturnValue(
      findOneReturning({ userId: { toString: () => 'other-user' }, family: FAMILY }),
    );
    const service = makeService(m);

    await service.logout(USER_ID, TOKEN);

    // Presenting a foreign token must NOT revoke the stranger's family AND must
    // NOT fall back to nuking the caller's sessions — that would let a replayed
    // token force-log-out a victim everywhere. So: no revoke at all.
    expect(m.sessionModel.updateMany).not.toHaveBeenCalled();
  });

  it('NO-OPs on an unknown token (no stored session) rather than revoking everything', async () => {
    const m = buildMocks('commit');
    m.sessionModel.findOne.mockReturnValue(findOneReturning(null));
    const service = makeService(m);

    await service.logout(USER_ID, TOKEN);

    expect(m.sessionModel.findOne).toHaveBeenCalledWith({ tokenHash: sha256(TOKEN) });
    expect(m.sessionModel.updateMany).not.toHaveBeenCalled();
  });
});

// ── revokeAllSessions (moderation ban hook) ──────────────────────────────────

describe('AuthService.revokeAllSessions', () => {
  it('soft-revokes every live session for the user', async () => {
    const m = buildMocks('commit');
    const service = makeService(m);

    await service.revokeAllSessions(USER_ID);

    expect(m.sessionModel.updateMany).toHaveBeenCalledTimes(1);
    const [filter, update] = m.sessionModel.updateMany.mock.calls[0] as [
      Record<string, unknown>,
      { $set: { revokedAt: Date } },
    ];
    expect(filter).toMatchObject({ revokedAt: null });
    expect(filter).toHaveProperty('userId');
    expect(update.$set.revokedAt).toBeInstanceOf(Date);
  });

  it('is a no-op for an invalid user id', async () => {
    const m = buildMocks('commit');
    const service = makeService(m);

    await service.revokeAllSessions('not-an-objectid');

    expect(m.sessionModel.updateMany).not.toHaveBeenCalled();
  });
});

// ── register: best-effort verification email ──────────────────────────────────

describe('AuthService.register — verification email (best-effort)', () => {
  /**
   * The mint + SMTP send are dispatched FIRE-AND-FORGET (decoupled from the
   * signup response) so a slow/hung SMTP host can never stall registration.
   * Flushing the microtask queue lets that background work settle so we can
   * assert it eventually ran without the caller having awaited it (mirrors the
   * `requestPasswordReset` spec).
   */
  const flushMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve));

  it('mints a verification token and sends the verify email on the happy path (in the background)', async () => {
    const m = buildMocks('commit');
    const service = makeService(m);

    const res = await service.register(makeRegisterDto());

    // A fresh account is reported unverified.
    expect(res.user.emailVerified).toBe(false);

    // The verify email is dispatched fire-and-forget — let the background work
    // settle before asserting it ran.
    await flushMicrotasks();

    // An `email_verify` token row was created and the verify email was sent to
    // the (lower-cased) address.
    expect(m.verificationTokenModel.create).toHaveBeenCalledTimes(1);
    const [tokenRow] = m.verificationTokenModel.create.mock.calls[0] as [
      { purpose: string; tokenHash: string; consumedAt: null },
    ];
    expect(tokenRow.purpose).toBe('email_verify');
    expect(tokenRow.consumedAt).toBeNull();
    // Only the HASH is persisted (64 hex chars), never the raw token.
    expect(tokenRow.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    expect(m.mailerService.sendVerificationEmail).toHaveBeenCalledTimes(1);
    const [to, sentToken] = m.mailerService.sendVerificationEmail.mock.calls[0] as [string, string];
    expect(to).toBe('new.user@example.com');
    // The emailed (raw) token hashes to exactly the stored hash.
    expect(sha256(sentToken)).toBe(tokenRow.tokenHash);
  });

  it('does NOT await the verification SMTP send: register() resolves BEFORE the email dispatch completes (a hung SMTP host cannot stall signup)', async () => {
    const m = buildMocks('commit');
    // A send that never settles would block the response IF it were awaited.
    let resolveSend!: () => void;
    m.mailerService.sendVerificationEmail.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSend = resolve;
      }) as never,
    );
    const service = makeService(m);

    // register() must resolve with a full token pair even though the SMTP send
    // is still pending → the send is fire-and-forget, not awaited.
    const res = await service.register(makeRegisterDto());
    expect(res.tokens.accessToken).toBeTruthy();
    expect(res.tokens.refreshToken).toBeTruthy();
    expect(m.sessionModel.create).toHaveBeenCalledTimes(1);

    resolveSend(); // let the background dispatch finish (no dangling promise).
    await flushMicrotasks();
  });

  it('still succeeds when the verify email fails to send (mail outage never fails signup)', async () => {
    const m = buildMocks('commit');
    m.mailerService.sendVerificationEmail.mockRejectedValue(new Error('smtp down'));
    const service = makeService(m);

    // Registration must resolve with tokens despite the mail failure.
    const res = await service.register(makeRegisterDto());
    expect(res.tokens.accessToken).toBeTruthy();
    expect(m.sessionModel.create).toHaveBeenCalledTimes(1);

    // The background dispatch swallows the SMTP failure (best-effort .catch);
    // flush so the internal catch runs and no unhandled rejection escapes.
    await flushMicrotasks();
  });
});

// ── verifyEmail ───────────────────────────────────────────────────────────────

describe('AuthService.verifyEmail', () => {
  const RAW = 'a'.repeat(64); // a plausible 64-hex raw token

  /** A consumable token row (findOneAndUpdate returns the pre-update doc). */
  function tokenRow(overrides: Record<string, unknown> = {}) {
    return { userId: { toString: () => USER_ID }, purpose: 'email_verify', ...overrides };
  }

  it('consumes a valid token and marks the account verified', async () => {
    const m = buildMocks('commit');
    m.verificationTokenModel.findOneAndUpdate.mockReturnValue(findOneReturning(tokenRow()));
    const service = makeService(m);

    await service.verifyEmail(RAW);

    // The atomic consume targets the hash + purpose + live (unconsumed/unexpired).
    expect(m.verificationTokenModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update] = m.verificationTokenModel.findOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
      { $set: { consumedAt: Date } },
    ];
    expect(filter).toMatchObject({
      tokenHash: sha256(RAW),
      purpose: 'email_verify',
      consumedAt: null,
    });
    expect(filter.expiresAt).toMatchObject({ $gt: expect.any(Date) });
    expect(update.$set.consumedAt).toBeInstanceOf(Date);

    expect(m.usersService.markEmailVerified).toHaveBeenCalledWith(USER_ID);
  });

  it('rejects an expired/unknown token (no live row matched) with BadRequestException', async () => {
    const m = buildMocks('commit');
    // No live token matched the compare-and-set (expired, unknown, or wrong purpose).
    m.verificationTokenModel.findOneAndUpdate.mockReturnValue(findOneReturning(null));
    const service = makeService(m);

    await expect(service.verifyEmail(RAW)).rejects.toBeInstanceOf(BadRequestException);
    expect(m.usersService.markEmailVerified).not.toHaveBeenCalled();
  });

  it('rejects a token that was ALREADY used (atomic consume finds no live row)', async () => {
    const m = buildMocks('commit');
    // First use consumes it; the row is no longer live, so the second consume
    // returns null — single-use is enforced by the compare-and-set filter.
    m.verificationTokenModel.findOneAndUpdate
      .mockReturnValueOnce(findOneReturning(tokenRow()))
      .mockReturnValueOnce(findOneReturning(null));
    const service = makeService(m);

    await service.verifyEmail(RAW); // first use OK
    await expect(service.verifyEmail(RAW)).rejects.toBeInstanceOf(BadRequestException);
    expect(m.usersService.markEmailVerified).toHaveBeenCalledTimes(1);
  });
});

// ── resendVerification ────────────────────────────────────────────────────────

describe('AuthService.resendVerification', () => {
  it('re-sends the verify email for an unverified, existing account', async () => {
    const m = buildMocks('commit');
    m.usersService.findById.mockResolvedValue(fakeUser({ emailVerified: false }) as never);
    const service = makeService(m);

    await service.resendVerification(USER_ID);

    expect(m.verificationTokenModel.create).toHaveBeenCalledTimes(1);
    expect(m.mailerService.sendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the account is already verified (no token, no email)', async () => {
    const m = buildMocks('commit');
    m.usersService.findById.mockResolvedValue(fakeUser({ emailVerified: true }) as never);
    const service = makeService(m);

    await service.resendVerification(USER_ID);

    expect(m.verificationTokenModel.create).not.toHaveBeenCalled();
    expect(m.mailerService.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('is a no-op when the account does not exist', async () => {
    const m = buildMocks('commit');
    m.usersService.findById.mockResolvedValue(null);
    const service = makeService(m);

    await service.resendVerification(USER_ID);

    expect(m.mailerService.sendVerificationEmail).not.toHaveBeenCalled();
  });
});

// ── requestPasswordReset (anti-enumeration) ───────────────────────────────────

describe('AuthService.requestPasswordReset', () => {
  /**
   * The mint + SMTP send are dispatched FIRE-AND-FORGET so the response timing
   * is independent of account existence (no enumeration via latency). Flushing
   * the microtask queue lets that background work settle so we can assert it
   * eventually ran without the caller having awaited it.
   */
  const flushMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve));

  it('mints a 1h reset token and emails it when the account exists (in the background)', async () => {
    const m = buildMocks('commit');
    m.usersService.findByEmail.mockResolvedValue(fakeUser() as never);
    const service = makeService(m);

    await service.requestPasswordReset('New.User@Example.com');

    // Lookup uses the normalised (lower-cased) email.
    expect(m.usersService.findByEmail).toHaveBeenCalledWith('new.user@example.com');

    // The legitimate reset email is still sent — just not on the awaited path.
    await flushMicrotasks();
    const [tokenRow] = m.verificationTokenModel.create.mock.calls[0] as [{ purpose: string }];
    expect(tokenRow.purpose).toBe('password_reset');
    expect(m.mailerService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it('does NOT await the SMTP send: resolves BEFORE the email dispatch completes (no timing oracle)', async () => {
    const m = buildMocks('commit');
    m.usersService.findByEmail.mockResolvedValue(fakeUser() as never);
    // A send that never settles would block the response IF it were awaited.
    let resolveSend!: () => void;
    m.mailerService.sendPasswordResetEmail.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSend = resolve;
      }) as never,
    );
    const service = makeService(m);

    // Must resolve even though the SMTP send is still pending → not awaited.
    await expect(service.requestPasswordReset('new.user@example.com')).resolves.toBeUndefined();

    resolveSend(); // let the background dispatch finish (no dangling promise).
    await flushMicrotasks();
  });

  it('does NOT reveal a missing account: resolves silently with no token + no email (no enumeration)', async () => {
    const m = buildMocks('commit');
    m.usersService.findByEmail.mockResolvedValue(null);
    const service = makeService(m);

    // Must resolve (the controller returns 204 regardless) and do no work.
    await expect(service.requestPasswordReset('nobody@example.com')).resolves.toBeUndefined();
    expect(m.verificationTokenModel.create).not.toHaveBeenCalled();
    expect(m.mailerService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('treats an already-erased (tombstoned) account as non-existent', async () => {
    const m = buildMocks('commit');
    m.usersService.findByEmail.mockResolvedValue(fakeUser({ deletedAt: new Date() }) as never);
    const service = makeService(m);

    await service.requestPasswordReset('deleted@example.com');

    expect(m.mailerService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('still resolves (no throw) when the reset email fails to send', async () => {
    const m = buildMocks('commit');
    m.usersService.findByEmail.mockResolvedValue(fakeUser() as never);
    m.mailerService.sendPasswordResetEmail.mockRejectedValue(new Error('smtp down'));
    const service = makeService(m);

    await expect(service.requestPasswordReset('new.user@example.com')).resolves.toBeUndefined();
    // The background dispatch swallows the SMTP failure (best-effort .catch);
    // flush so the internal catch runs and no unhandled rejection escapes.
    await flushMicrotasks();
  });
});

// ── resetPassword (consume token + revoke sessions) ──────────────────────────

describe('AuthService.resetPassword', () => {
  const RAW = 'b'.repeat(64);
  const NEW_PASSWORD = 'a-brand-new-strong-pw-9';

  function resetRow(overrides: Record<string, unknown> = {}) {
    return {
      userId: { toString: () => USER_ID },
      purpose: 'password_reset',
      ...overrides,
    };
  }

  it('consumes the token, stores a NEW argon2 hash, and revokes ALL sessions', async () => {
    const m = buildMocks('commit');
    m.verificationTokenModel.findOneAndUpdate.mockReturnValue(findOneReturning(resetRow()));
    const service = makeService(m);

    await service.resetPassword(RAW, NEW_PASSWORD);

    // The reset token (hash + purpose) was atomically consumed.
    const [filter] = m.verificationTokenModel.findOneAndUpdate.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(filter).toMatchObject({
      tokenHash: sha256(RAW),
      purpose: 'password_reset',
      consumedAt: null,
    });

    // A fresh argon2 hash (not the plaintext) is persisted and verifies.
    expect(m.usersService.updatePasswordHash).toHaveBeenCalledTimes(1);
    const [uid, newHash] = m.usersService.updatePasswordHash.mock.calls[0] as [string, string];
    expect(uid).toBe(USER_ID);
    expect(newHash).not.toBe(NEW_PASSWORD);
    expect(newHash.startsWith('$argon2id$')).toBe(true);
    await expect(argon2.verify(newHash, NEW_PASSWORD)).resolves.toBe(true);

    // EVERY live refresh session for the user is revoked (session-revoke hook).
    expect(m.sessionModel.updateMany).toHaveBeenCalledTimes(1);
    const [revokeFilter, revokeUpdate] = m.sessionModel.updateMany.mock.calls[0] as [
      Record<string, unknown>,
      { $set: { revokedAt: Date } },
    ];
    expect(revokeFilter).toMatchObject({ revokedAt: null });
    expect(revokeFilter).toHaveProperty('userId');
    expect(revokeUpdate.$set.revokedAt).toBeInstanceOf(Date);
  });

  it('rejects an invalid/expired token with BadRequestException and changes nothing', async () => {
    const m = buildMocks('commit');
    m.verificationTokenModel.findOneAndUpdate.mockReturnValue(findOneReturning(null));
    const service = makeService(m);

    await expect(service.resetPassword(RAW, NEW_PASSWORD)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(m.usersService.updatePasswordHash).not.toHaveBeenCalled();
    expect(m.sessionModel.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a top-common new password BEFORE consuming the token', async () => {
    const m = buildMocks('commit');
    const service = makeService(m);

    await expect(service.resetPassword(RAW, 'password123')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // The breached-password guard runs first, so the token is never touched.
    expect(m.verificationTokenModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(m.usersService.updatePasswordHash).not.toHaveBeenCalled();
  });

  it('rejects with BadRequestException when the token is valid but the account is gone', async () => {
    const m = buildMocks('commit');
    m.verificationTokenModel.findOneAndUpdate.mockReturnValue(findOneReturning(resetRow()));
    // The update found no matching (non-deleted) account.
    m.usersService.updatePasswordHash.mockResolvedValue(false);
    const service = makeService(m);

    await expect(service.resetPassword(RAW, NEW_PASSWORD)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // No session revoke when the password change did not land.
    expect(m.sessionModel.updateMany).not.toHaveBeenCalled();
  });
});

// ── changePassword (authenticated, verify current) ────────────────────────────

describe('AuthService.changePassword', () => {
  const CURRENT_PASSWORD = PLAINTEXT_PASSWORD;
  const NEW_PASSWORD = 'a-brand-new-strong-pw-9';

  /** A user row carrying a REAL argon2 hash of `password` (+ the secret field). */
  async function userWithRealHash(
    password = CURRENT_PASSWORD,
    overrides: Record<string, unknown> = {},
  ) {
    return fakeUser({ passwordHash: await argon2.hash(password), ...overrides });
  }

  it('verifies the current password, stores a NEW argon2 hash, and revokes ALL sessions', async () => {
    const m = buildMocks('commit');
    m.usersService.findByIdWithSecret.mockResolvedValue((await userWithRealHash()) as never);
    const service = makeService(m);

    await service.changePassword(USER_ID, {
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    // The credential row was read by id WITH the hidden hash.
    expect(m.usersService.findByIdWithSecret).toHaveBeenCalledWith(USER_ID);

    // A fresh argon2 hash (not the plaintext) is persisted and verifies.
    expect(m.usersService.updatePasswordHash).toHaveBeenCalledTimes(1);
    const [uid, newHash] = m.usersService.updatePasswordHash.mock.calls[0] as [string, string];
    expect(uid).toBe(USER_ID);
    expect(newHash).not.toBe(NEW_PASSWORD);
    expect(newHash.startsWith('$argon2id$')).toBe(true);
    await expect(argon2.verify(newHash, NEW_PASSWORD)).resolves.toBe(true);

    // EVERY live refresh session for the user is revoked (session-revoke hook).
    expect(m.sessionModel.updateMany).toHaveBeenCalledTimes(1);
    const [revokeFilter, revokeUpdate] = m.sessionModel.updateMany.mock.calls[0] as [
      Record<string, unknown>,
      { $set: { revokedAt: Date } },
    ];
    expect(revokeFilter).toMatchObject({ revokedAt: null });
    expect(revokeFilter).toHaveProperty('userId');
    expect(revokeUpdate.$set.revokedAt).toBeInstanceOf(Date);
  });

  it('rejects a wrong current password with UnauthorizedException and changes nothing', async () => {
    const m = buildMocks('commit');
    m.usersService.findByIdWithSecret.mockResolvedValue((await userWithRealHash()) as never);
    const service = makeService(m);

    const err = await service
      .changePassword(USER_ID, { currentPassword: 'not-my-password', newPassword: NEW_PASSWORD })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).message).toBe('Current password is incorrect');
    expect(m.usersService.updatePasswordHash).not.toHaveBeenCalled();
    expect(m.sessionModel.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a new password equal to the current one with BadRequestException', async () => {
    const m = buildMocks('commit');
    m.usersService.findByIdWithSecret.mockResolvedValue((await userWithRealHash()) as never);
    const service = makeService(m);

    await expect(
      service.changePassword(USER_ID, {
        currentPassword: CURRENT_PASSWORD,
        newPassword: CURRENT_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(m.usersService.updatePasswordHash).not.toHaveBeenCalled();
    expect(m.sessionModel.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a top-common new password with BadRequestException (breached-password floor)', async () => {
    const m = buildMocks('commit');
    m.usersService.findByIdWithSecret.mockResolvedValue((await userWithRealHash()) as never);
    const service = makeService(m);

    await expect(
      service.changePassword(USER_ID, {
        currentPassword: CURRENT_PASSWORD,
        newPassword: 'password123',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(m.usersService.updatePasswordHash).not.toHaveBeenCalled();
    expect(m.sessionModel.updateMany).not.toHaveBeenCalled();
  });

  it('rejects with UnauthorizedException when the account no longer exists', async () => {
    const m = buildMocks('commit');
    m.usersService.findByIdWithSecret.mockResolvedValue(null);
    const service = makeService(m);

    await expect(
      service.changePassword(USER_ID, {
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(m.usersService.updatePasswordHash).not.toHaveBeenCalled();
    expect(m.sessionModel.updateMany).not.toHaveBeenCalled();
  });
});

// ── listSessions / revokeSession / revokeOtherSessions (devices surface) ──────

describe('AuthService session management (devices surface)', () => {
  const CURRENT_TOKEN = 'refresh.token.current';
  const FAM_CURRENT = 'fam-current';
  const FAM_OTHER = 'fam-other';

  /** A lean session row as returned by `.find().select().lean().exec()`. */
  function leanRow(overrides: Record<string, unknown> = {}) {
    const now = Date.now();
    return {
      family: FAM_OTHER,
      ip: '1.2.3.4',
      userAgent: 'Mozilla/5.0',
      device: null,
      createdAt: new Date(now - 60_000),
      updatedAt: new Date(now - 60_000),
      ...overrides,
    };
  }

  /** Stub `sessionModel.find(...)` to resolve `rows` through the lean chain. */
  function stubFind(m: Mocks, rows: unknown[]): void {
    m.sessionModel.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(rows),
    });
  }

  /**
   * Stub the current-family resolution: `resolveCurrentFamily` calls
   * `findOne({ userId, tokenHash }).select('family').lean().exec()`. Resolve it
   * to a row carrying `family`, or `null` when no current session matches.
   */
  function stubCurrentFamily(m: Mocks, family: string | null): void {
    m.sessionModel.findOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(family === null ? null : { family }),
    });
  }

  describe('listSessions', () => {
    it('collapses rotation rows by family and flags the current device', async () => {
      const m = buildMocks('commit');
      stubCurrentFamily(m, FAM_CURRENT);
      const now = Date.now();
      stubFind(m, [
        // Current family: two rotation rows → one entry; lastActive = newest.
        leanRow({
          family: FAM_CURRENT,
          createdAt: new Date(now - 120_000),
          updatedAt: new Date(now - 120_000),
          ip: '9.9.9.9',
        }),
        leanRow({
          family: FAM_CURRENT,
          createdAt: new Date(now - 30_000),
          updatedAt: new Date(now - 5_000),
          ip: '9.9.9.9',
        }),
        // A second, different login.
        leanRow({ family: FAM_OTHER, createdAt: new Date(now - 90_000) }),
      ]);
      const service = makeService(m);

      const sessions = await service.listSessions(USER_ID, CURRENT_TOKEN);

      // Two logical sessions (one per family), current sorted first.
      expect(sessions).toHaveLength(2);
      expect(sessions[0]?.id).toBe(FAM_CURRENT);
      expect(sessions[0]?.current).toBe(true);
      expect(sessions[1]?.id).toBe(FAM_OTHER);
      expect(sessions[1]?.current).toBe(false);

      // The current entry's lastActiveAt reflects the NEWEST rotation (~5s ago),
      // while createdAt reflects the OLDEST row (~120s ago).
      expect(new Date(sessions[0]!.lastActiveAt).getTime()).toBe(now - 5_000);
      expect(new Date(sessions[0]!.createdAt).getTime()).toBe(now - 120_000);

      // Only live (un-revoked, unexpired) rows for THIS user are queried.
      const [findFilter] = m.sessionModel.find.mock.calls[0] as [Record<string, unknown>];
      expect(findFilter).toMatchObject({ revokedAt: null });
      expect(findFilter).toHaveProperty('userId');
      expect(findFilter.expiresAt).toMatchObject({ $gt: expect.any(Date) });
    });

    it('returns no current flag when the refresh token maps to no live row', async () => {
      const m = buildMocks('commit');
      stubCurrentFamily(m, null); // cookie token resolves to nothing
      stubFind(m, [leanRow({ family: FAM_OTHER })]);
      const service = makeService(m);

      const sessions = await service.listSessions(USER_ID, 'stale-or-foreign-token');

      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.current).toBe(false);
    });

    it('does not resolve a current family when no token is supplied (never queries findOne)', async () => {
      const m = buildMocks('commit');
      stubFind(m, [leanRow({ family: FAM_OTHER })]);
      const service = makeService(m);

      const sessions = await service.listSessions(USER_ID);

      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.current).toBe(false);
      // No current-token → the family lookup is skipped entirely.
      expect(m.sessionModel.findOne).not.toHaveBeenCalled();
    });

    it('returns [] for an invalid user id without touching the store', async () => {
      const m = buildMocks('commit');
      const service = makeService(m);

      await expect(service.listSessions('not-an-objectid')).resolves.toEqual([]);
      expect(m.sessionModel.find).not.toHaveBeenCalled();
    });
  });

  describe('revokeSession', () => {
    it('revokes the family scoped to the owner and reports success', async () => {
      const m = buildMocks('commit');
      m.sessionModel.updateMany.mockReturnValue(findOneReturning({ modifiedCount: 2 }));
      const service = makeService(m);

      const ok = await service.revokeSession(USER_ID, FAM_OTHER);

      expect(ok).toBe(true);
      const [filter, update] = m.sessionModel.updateMany.mock.calls[0] as [
        Record<string, unknown>,
        { $set: { revokedAt: Date } },
      ];
      // Owner-scoped: userId AND family AND only-live rows.
      expect(filter).toMatchObject({ family: FAM_OTHER, revokedAt: null });
      expect(filter).toHaveProperty('userId');
      expect(update.$set.revokedAt).toBeInstanceOf(Date);
    });

    it('returns false when nothing matched (unknown / foreign / already-revoked id)', async () => {
      const m = buildMocks('commit');
      m.sessionModel.updateMany.mockReturnValue(findOneReturning({ modifiedCount: 0 }));
      const service = makeService(m);

      await expect(service.revokeSession(USER_ID, 'fam-nope')).resolves.toBe(false);
    });

    it('is a no-op (false) for an invalid user id or empty session id', async () => {
      const m = buildMocks('commit');
      const service = makeService(m);

      await expect(service.revokeSession('not-an-objectid', FAM_OTHER)).resolves.toBe(false);
      await expect(service.revokeSession(USER_ID, '')).resolves.toBe(false);
      expect(m.sessionModel.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('revokeOtherSessions', () => {
    it('revokes every live family EXCEPT the current one and reports it preserved', async () => {
      const m = buildMocks('commit');
      stubCurrentFamily(m, FAM_CURRENT);
      const service = makeService(m);

      const result = await service.revokeOtherSessions(USER_ID, CURRENT_TOKEN);

      expect(result).toEqual({ currentPreserved: true });
      expect(m.sessionModel.updateMany).toHaveBeenCalledTimes(1);
      const [filter, update] = m.sessionModel.updateMany.mock.calls[0] as [
        Record<string, unknown>,
        { $set: { revokedAt: Date } },
      ];
      expect(filter).toMatchObject({ revokedAt: null, family: { $ne: FAM_CURRENT } });
      expect(filter).toHaveProperty('userId');
      expect(update.$set.revokedAt).toBeInstanceOf(Date);
    });

    it('revokes ALL live sessions when NO cookie is supplied (true log-out-everywhere)', async () => {
      const m = buildMocks('commit');
      const service = makeService(m);

      // No token → no family exclusion; behaves like revokeAllSessions.
      const result = await service.revokeOtherSessions(USER_ID);

      expect(result).toEqual({ currentPreserved: false });
      const [filter] = m.sessionModel.updateMany.mock.calls[0] as [Record<string, unknown>];
      expect(filter).toMatchObject({ revokedAt: null });
      expect(filter).not.toHaveProperty('family');
      expect(m.sessionModel.findOne).not.toHaveBeenCalled();
    });

    it('REVOKES NOTHING when a cookie IS presented but its family cannot be resolved (never nukes the current device)', async () => {
      const m = buildMocks('commit');
      // A cookie is sent but it maps to no live family (stale/rotated/foreign).
      stubCurrentFamily(m, null);
      const service = makeService(m);

      // The OLD bug: this fell back to revoking ALL — logging the caller out of
      // the very device performing the action. It must now be a safe no-op.
      const result = await service.revokeOtherSessions(USER_ID, 'stale-or-foreign-token');

      expect(result).toEqual({ currentPreserved: false });
      expect(m.sessionModel.updateMany).not.toHaveBeenCalled();
    });

    it('is a no-op for an invalid user id', async () => {
      const m = buildMocks('commit');
      const service = makeService(m);

      const result = await service.revokeOtherSessions('not-an-objectid', CURRENT_TOKEN);
      expect(result).toEqual({ currentPreserved: false });
      expect(m.sessionModel.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('isCurrentSession', () => {
    it('is true only when the family matches the presented token’s family', async () => {
      const m = buildMocks('commit');
      stubCurrentFamily(m, FAM_CURRENT);
      const service = makeService(m);

      await expect(service.isCurrentSession(USER_ID, FAM_CURRENT, CURRENT_TOKEN)).resolves.toBe(
        true,
      );
    });

    it('is false when the family differs from the presented token’s family', async () => {
      const m = buildMocks('commit');
      stubCurrentFamily(m, FAM_CURRENT);
      const service = makeService(m);

      await expect(service.isCurrentSession(USER_ID, FAM_OTHER, CURRENT_TOKEN)).resolves.toBe(
        false,
      );
    });
  });
});
