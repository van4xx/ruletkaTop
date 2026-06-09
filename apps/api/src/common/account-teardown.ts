import { Connection, Types } from 'mongoose';

/**
 * SHARED ACCOUNT-TEARDOWN HELPERS — the launch-gating legal/billing cluster.
 *
 * These are plain functions (NOT NestJS providers) operating purely on the
 * injected Mongoose {@link Connection} by collection NAME. That keeps them free
 * of any module-graph dependency: `UsersService.eraseAccount`,
 * `AdminUsersService.deleteUser` and `AdminService.banUser` each already inject
 * a `Connection` and can call these directly without importing the economy /
 * premium / payments modules (mirroring how those services already scrub
 * `profiles` / `sessions` by name).
 *
 * THREE teardown shapes, by `TeardownMode`:
 *  - `'erase'`  — the user's own 152-ФЗ / GDPR right-to-be-forgotten (permanent).
 *  - `'delete'` — admin-initiated permanent erasure (mirrors `'erase'`).
 *  - `'ban'`    — a REVERSIBLE moderation sanction.
 *
 * Permanent teardown (`erase`/`delete`):
 *  - billing is force-cancelled (subscription driven to a terminal `none` state,
 *    upstream CloudPayments subscription best-effort cancelled) — see
 *    {@link cancelSubscriptionForTeardown};
 *  - the wallet balance is ZEROED (the coins are forfeit; the append-only ledger
 *    is retained for accounting);
 *  - active Top-feed placements are EXPIRED (tombstoned).
 *
 * Reversible teardown (`ban`):
 *  - billing is force-cancelled too (a banned user must not keep being billed),
 *    but the wallet is LEFT INTACT — an unban restores the account, so we must
 *    not destroy reversible balance;
 *  - active paid Top-feed placements are EXPIRED so a banned user's promotion
 *    stops showing immediately (read-guards also drop them, but expiring the
 *    paid placement is the durable suspension).
 *
 * Every side effect is BEST-EFFORT + awaited-but-never-fatal (mirrors
 * `AuditService.log`): a teardown is layered defence and a single collection
 * hiccup must never abort the erase/delete/ban. Failures are surfaced to the
 * optional `onWarn` callback (the caller's logger) and otherwise swallowed.
 */
export type TeardownMode = 'erase' | 'delete' | 'ban';

/** Optional hooks the caller wires in (logging + the upstream billing cancel). */
export interface TeardownDeps {
  /** Log a non-fatal teardown failure (typically `logger.warn`). */
  onWarn?: (message: string) => void;
  /**
   * Best-effort cancel of the upstream CloudPayments subscription by its
   * server-only `subscriptionId`. Injected by the caller (a thin payments cancel
   * port) so this helper takes no payments-module dependency. Omit to skip the
   * upstream call (local terminal-state drive still runs). MUST never throw —
   * any provider error is the caller's to swallow.
   */
  cancelUpstream?: (subscriptionId: string) => Promise<void>;
}

/**
 * Force-cancel a user's premium billing as part of a permanent or reversible
 * teardown. Best-effort + never throws.
 *
 * Steps (each independent, each non-fatal):
 *  1. read the (server-only) `subscriptionId` off the `subscriptions` row;
 *  2. if present AND a `cancelUpstream` port was supplied, ask CloudPayments to
 *     stop billing it (so a renewal charge never lands after teardown);
 *  3. drive the local subscription row to a TERMINAL state — `status:'none'`,
 *     `cancelAtPeriodEnd:false`, `currentPeriodEnd` in the past, and the
 *     server-only `token`/`subscriptionId` nulled (no stored card token lingers
 *     on a torn-down account);
 *  4. clear the denormalised premium flags on the `profiles` row
 *     (`isPremium:false`, `premiumUntil:null`) and pull the `'premium'` badge.
 *
 * The subscription read uses `.collection('subscriptions')` directly (the
 * server-only `token`/`subscriptionId` are `select:false` on the Mongoose model
 * but the native driver projection still returns them).
 */
export async function cancelSubscriptionForTeardown(
  connection: Connection,
  objectId: Types.ObjectId,
  deps: TeardownDeps = {},
): Promise<void> {
  const warn = deps.onWarn ?? (() => undefined);

  // 1) Read the server-only subscriptionId (native driver ignores select:false).
  let subscriptionId: string | null = null;
  try {
    const sub = (await connection
      .collection('subscriptions')
      .findOne({ userId: objectId }, { projection: { subscriptionId: 1 } })) as {
      subscriptionId?: string | null;
    } | null;
    subscriptionId = typeof sub?.subscriptionId === 'string' ? sub.subscriptionId : null;
  } catch (err) {
    warn(`teardown: failed to read subscription: ${(err as Error).message}`);
  }

  // 2) Best-effort upstream cancel so the provider stops billing the card.
  if (subscriptionId && deps.cancelUpstream) {
    try {
      await deps.cancelUpstream(subscriptionId);
    } catch (err) {
      warn(`teardown: upstream subscription cancel failed: ${(err as Error).message}`);
    }
  }

  // 3) Drive the local subscription row to a terminal, non-billing state and
  //    strip the stored recurring token / subscription id.
  try {
    await connection.collection('subscriptions').updateOne(
      { userId: objectId },
      {
        $set: {
          status: 'none',
          cancelAtPeriodEnd: false,
          currentPeriodEnd: TEARDOWN_PAST_DATE,
          token: null,
          subscriptionId: null,
        },
      },
    );
  } catch (err) {
    warn(`teardown: failed to terminate subscription: ${(err as Error).message}`);
  }

  // 4) Clear the denormalised premium flags + pull the premium badge on profile.
  try {
    await connection.collection('profiles').updateOne(
      { userId: objectId },
      {
        $set: { isPremium: false, premiumUntil: null },
        // `$pull` of a scalar from a string[] field trips the native-driver's
        // `PullOperator` typing (it expects a filter expr per field); the runtime
        // semantics are correct, so cast the update object minimally.
        $pull: { badges: 'premium' },
      } as Record<string, unknown>,
    );
  } catch (err) {
    warn(`teardown: failed to clear premium denormalisation: ${(err as Error).message}`);
  }
}

/**
 * Leaderboard + Top-feed write-time teardown shared by erase / delete / ban.
 *
 * WRITE-TIME effects (read-time guards live in the leaderboard / top services):
 *  - wallet balance is ZEROED for PERMANENT teardown only (`erase`/`delete`); a
 *    `ban` is reversible so the balance is preserved;
 *  - active Top placements (`expiresAt > now`) are EXPIRED for ALL modes —
 *    flipped to `{ expiresAt: now, expired: true }` so a torn-down/banned user's
 *    paid promotion stops showing immediately.
 *
 * Best-effort + never throws; each collection is independent.
 */
export async function runLeaderboardTopTeardown(
  connection: Connection,
  objectId: Types.ObjectId,
  mode: TeardownMode,
  deps: TeardownDeps = {},
): Promise<void> {
  const warn = deps.onWarn ?? (() => undefined);
  const now = new Date();

  // Zero the wallet for PERMANENT teardown only — a ban must stay reversible.
  if (mode !== 'ban') {
    try {
      await connection
        .collection('wallets')
        .updateOne({ userId: objectId }, { $set: { balanceCoins: 0 } });
    } catch (err) {
      warn(`teardown: failed to zero wallet: ${(err as Error).message}`);
    }
  }

  // Expire active Top placements for every mode (suspend the paid promotion).
  try {
    await connection
      .collection('topplacements')
      .updateMany(
        { userId: objectId, expiresAt: { $gt: now } },
        { $set: { expiresAt: now, expired: true } },
      );
  } catch (err) {
    warn(`teardown: failed to expire top placements: ${(err as Error).message}`);
  }
}

/**
 * PERMANENT-ERASURE PII scrub across the remaining collections that still carry
 * personal data the user authored — the long-tail right-to-be-forgotten cleanup
 * that complements the credential/profile/settings/session/message scrub in
 * `UsersService.eraseAccount`. Permanent teardown ONLY (`erase`/`delete`); a
 * reversible `ban` must NOT destroy this data.
 *
 * Scrubbed here (each independent + best-effort, mirroring the warn pattern):
 *  - `device_tokens` / `push_subscriptions` — the user's push endpoints are
 *    DELETED (a device/browser routing identifier is PII and serves no post-
 *    erasure purpose; we must also stop pushing to a forgotten account);
 *  - `gifttransactions.message` — the free-text note the user AUTHORED (as
 *    sender) is redacted to `null` (the financial row itself is retained for
 *    accounting, like the coin ledger, but the personal note is stripped);
 *  - `reports.details` / `reports.evidenceUrl` — the free-text and captured
 *    frame the user AUTHORED (as reporter, `fromUserId`) are redacted; the row
 *    is kept so the moderation record against the target survives;
 *  - `moderation_events.evidenceUrl` — the captured JPEG frame of the user's own
 *    flagged frames (`userId`) is NULLED, but the row is RETAINED (label/score/
 *    action) for the abuse audit trail.
 *
 * NOT touched here (lawful retention, handled elsewhere / intentionally kept):
 *  - `payments` — financial records are retained under accounting/tax law; the
 *    `userId` link is left intact but the person is de-identified via the User
 *    tombstone (no direct PII lives on a payment row — card data never touches
 *    our DB);
 *  - `cointransactions` / `gifttransactions` ROWS — the append-only ledgers are
 *    retained (de-identified via the User tombstone), as documented on
 *    `eraseAccount`.
 *
 * The avatar FILE on disk is removed by the caller (it holds the
 * `AvatarStorageService` + the pre-scrub `avatarUrl`); this helper covers the DB.
 */
export async function runErasurePiiScrub(
  connection: Connection,
  objectId: Types.ObjectId,
  deps: TeardownDeps = {},
): Promise<void> {
  const warn = deps.onWarn ?? (() => undefined);

  // Push routing identifiers (PII) — delete; also stops post-erasure delivery.
  try {
    await connection.collection('device_tokens').deleteMany({ userId: objectId });
  } catch (err) {
    warn(`teardown: failed to delete device tokens: ${(err as Error).message}`);
  }
  try {
    await connection.collection('push_subscriptions').deleteMany({ userId: objectId });
  } catch (err) {
    warn(`teardown: failed to delete push subscriptions: ${(err as Error).message}`);
  }

  // Authored gift notes (sender free-text) — redact, keep the financial row.
  try {
    await connection
      .collection('gifttransactions')
      .updateMany({ fromUserId: objectId }, { $set: { message: null } });
  } catch (err) {
    warn(`teardown: failed to redact gift messages: ${(err as Error).message}`);
  }

  // Authored abuse reports (reporter free-text + captured frame) — redact, keep
  // the row so the record against the reported user survives.
  try {
    await connection
      .collection('reports')
      .updateMany({ fromUserId: objectId }, { $set: { details: null, evidenceUrl: null } });
  } catch (err) {
    warn(`teardown: failed to redact authored reports: ${(err as Error).message}`);
  }

  // The user's own moderation evidence frames — null the captured JPEG but RETAIN
  // the event row (label/score/action) for the abuse audit trail.
  try {
    await connection
      .collection('moderation_events')
      .updateMany({ userId: objectId }, { $set: { evidenceUrl: null } });
  } catch (err) {
    warn(`teardown: failed to null moderation evidence: ${(err as Error).message}`);
  }
}

/**
 * The full teardown side-effects for one account, in one call: billing cancel +
 * leaderboard/Top tombstoning, plus (for PERMANENT modes) the long-tail PII
 * scrub. Convenience wrapper invoked by `eraseAccount` / `deleteUser` /
 * `banUser`. Best-effort throughout.
 */
export async function runAccountTeardown(
  connection: Connection,
  objectId: Types.ObjectId,
  mode: TeardownMode,
  deps: TeardownDeps = {},
): Promise<void> {
  await cancelSubscriptionForTeardown(connection, objectId, deps);
  await runLeaderboardTopTeardown(connection, objectId, mode, deps);
  // Permanent erasure also scrubs the long-tail PII collections; a reversible
  // ban leaves them intact (an unban restores the account).
  if (mode !== 'ban') {
    await runErasurePiiScrub(connection, objectId, deps);
  }
}

/**
 * A safely-in-the-past `currentPeriodEnd` stamped on a torn-down subscription so
 * the `status==='active' && currentPeriodEnd>now` entitlement check fails even
 * if some path missed the `status` flip. Fixed epoch-ish constant (not `now`) so
 * it reads unambiguously as "long expired".
 */
const TEARDOWN_PAST_DATE = new Date(0);
