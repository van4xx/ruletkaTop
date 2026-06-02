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
