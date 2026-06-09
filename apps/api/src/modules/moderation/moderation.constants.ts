import type { ModerationActionPayload, ModerationLabel } from '@ruletka/shared-types';

/**
 * Cross-instance coordination channel for forcibly disconnecting a user's live
 * sockets (used by the ban flow).
 *
 * The moderation/admin surface PUBLISHES the banned user's id here when an
 * account is banned. The realtime gateways (the `realtime-security` subscriber)
 * SUBSCRIBE and disconnect every socket bound to that user, so a ban takes
 * effect immediately cluster-wide rather than waiting for the next `isBanned`
 * re-validation on a subsequent event.
 *
 * WIRE CONTRACT: the message body is the RAW user id string (a Mongo ObjectId
 * hex), NOT JSON — this matches the subscriber, which reads `message.trim()` as
 * the userId. The channel name MUST stay identical to the subscriber's
 * `USER_DISCONNECT_CHANNEL` (`realtime-security.constants.ts`).
 */
export const USER_DISCONNECT_CHANNEL = 'user:disconnect';

/**
 * Cross-instance channel on which {@link ModerationService} PUBLISHES a forced
 * mid-call action (warn / kick / ban) for the offending user, so the realtime
 * gateway — on whichever API node holds that user's socket — can emit
 * `mod:action` to them and (on kick/ban) tear down their active call.
 *
 * WIRE CONTRACT: the message body is JSON `{ userId, payload }` where `payload`
 * is a {@link ModerationActionPayload}. The matchmaking gateway subscribes to
 * this channel (a small hook in `matchmaking.gateway.ts`) and dispatches the
 * action. Banning ALSO goes through the existing {@link USER_DISCONNECT_CHANNEL}
 * (via `AdminService.banUser`) to sever every socket cluster-wide; this channel
 * additionally delivers the user-facing `mod:action` reason + ends the call.
 */
export const MODERATION_ACTION_CHANNEL = 'moderation:action';

/** Shape published on {@link MODERATION_ACTION_CHANNEL} (JSON-encoded). */
export interface ModerationActionMessage {
  userId: string;
  payload: ModerationActionPayload;
}

/**
 * Cross-instance channel on which {@link BlocksService} PUBLISHES a freshly
 * created block so the realtime gateway can FORCE-END any active call between
 * the two users immediately (a block must sever a call in progress, not just
 * prevent future matches).
 *
 * WIRE CONTRACT: the message body is JSON `{ userId, blockedUserId }` (the
 * blocker and the blocked, both Mongo ObjectId hex). The matchmaking gateway
 * subscribes (a small hook in `matchmaking.gateway.ts`) and tears down the room
 * ONLY if those two users are currently matched together — so an unrelated call
 * either user happens to be in is never disturbed. Best-effort: a publish
 * failure just means the (already-effective) block won't retroactively end a
 * live call; the bidirectional `isBlocked` gate still prevents re-matching.
 *
 * Decoupled via Redis (not a direct gateway dependency) to keep the moderation
 * module free of a `MatchmakingModule` cycle, exactly like
 * {@link MODERATION_ACTION_CHANNEL}.
 */
export const BLOCK_ENFORCE_CHANNEL = 'block:enforce';

/** Shape published on {@link BLOCK_ENFORCE_CHANNEL} (JSON-encoded). */
export interface BlockEnforceMessage {
  /** The user who created the block. */
  userId: string;
  /** The user who was blocked. */
  blockedUserId: string;
}

// ── Escalation policy tunables ───────────────────────────────────────────────

/**
 * Rolling window (ms) over which a user's prior violations are counted for
 * escalation. Old events age out so a single bad frame months apart does not
 * stack toward a ban. Defaults to 24h.
 */
export const ESCALATION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Score at/above which a SINGLE violation is treated as high-confidence and
 * triggers an immediate ban (bypassing warn→kick), for non-`minor` labels.
 */
export const HIGH_SCORE_THRESHOLD = 0.9;

/**
 * Per-user violation count (within {@link ESCALATION_WINDOW_MS}) that escalates
 * to a kick (2nd strike) and a ban (3rd strike). The 1st strike is a warning.
 */
export const KICK_AT_VIOLATION = 2;
export const BAN_AT_VIOLATION = 3;

/**
 * Labels treated as zero-tolerance: any event with one of these labels is an
 * instant permanent ban + evidence retention + review flag, regardless of score
 * or prior count. `minor` is CSAM-risk; see the CSAM note in the module summary.
 */
export const ZERO_TOLERANCE_LABELS: readonly import('@ruletka/shared-types').ModerationLabel[] = [
  'minor',
];

// ── Abuse-evidence retention (152-ФЗ / GDPR data-minimisation) ───────────────

/**
 * Statutory-minimum retention floor (ms) for captured abuse evidence
 * (`reports.evidenceUrl` / `moderation_events.evidenceUrl`). Evidence is purged
 * only once a case is TERMINAL (`resolved`/`dismissed`) AND at least this long
 * has elapsed since the decision — so a closed case's frame survives a minimum
 * window for appeal review / dispute, then is dropped to honour
 * data-minimisation (we must not hold a person's captured image forever).
 *
 * 90 days balances the appeals window (see `appeals.service`) and a conservative
 * complaint/dispute floor. Tune per legal counsel.
 */
export const EVIDENCE_RETENTION_FLOOR_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Hard ceiling (ms) after which evidence is purged regardless of case status —
 * a backstop so an event/report that is never triaged to a terminal state does
 * NOT retain its captured frame indefinitely (unbounded retention is the exact
 * finding this bound closes). Set comfortably above the appeals/dispute window;
 * 1 year. The purge only nulls the `evidenceUrl` blob — the row (label/score/
 * action/status) is RETAINED for the audit trail.
 *
 * NOTE — CSAM ESCALATION HOOK (TODO): for `minor` (CSAM-risk) events the
 * captured frame must NOT simply be silently deleted on expiry. The legally
 * required workflow is to hand the evidence to law enforcement / a hotline
 * (e.g. NCMEC) BEFORE purge and record the referral. That full
 * report-to-authority workflow is a separate product task; this retention sweep
 * intentionally still purges the blob on the ceiling to avoid unbounded
 * retention, but a real deployment MUST wire a pre-purge CSAM escalation hook
 * here (preserve + refer `minor`-label evidence) before this runs in production.
 */
export const EVIDENCE_RETENTION_CEILING_MS = 365 * 24 * 60 * 60 * 1000;

/** Terminal case statuses after which the retention FLOOR starts counting. */
export const EVIDENCE_TERMINAL_STATUSES: readonly import('@ruletka/shared-types').ReportStatus[] = [
  'resolved',
  'dismissed',
];
