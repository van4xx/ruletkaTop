import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Redis } from 'ioredis';
import { Model, Types } from 'mongoose';

import type {
  ModerationAction,
  ModerationActionPayload,
  ModerationLabel,
  ModerationViolationDto,
} from '@ruletka/shared-types';

import type { ClientSignalDto } from './moderation.contracts';

import { REDIS_CLIENT } from '../../redis/redis.constants';
import { AdminService } from './admin.service';
import { FRAME_SCORER, type FrameScorer } from './frame-scorer';
import {
  BAN_AT_VIOLATION,
  ESCALATION_WINDOW_MS,
  HIGH_SCORE_THRESHOLD,
  KICK_AT_VIOLATION,
  MODERATION_ACTION_CHANNEL,
  type ModerationActionMessage,
  ZERO_TOLERANCE_LABELS,
} from './moderation.constants';
import { ModerationEvent, ModerationEventDocument } from './schemas/moderation-event.schema';

/**
 * The escalation outcome of a single violation: the persisted event id, the
 * action taken and (for ban) whether it is permanent.
 */
interface EscalationDecision {
  action: ModerationAction;
  /** Human-readable reason surfaced to the offender via `mod:action`. */
  reason: string;
  /** Whether the action requires an immediate ban side-effect. */
  ban: boolean;
  /** Whether the ban is permanent (CSAM/zero-tolerance) vs policy-temporary. */
  permanent: boolean;
}

/**
 * Server-side moderation engine: ingests client-reported (or server-detected)
 * frame violations, persists them as {@link ModerationEvent}s with retained
 * evidence, applies an ESCALATION POLICY and drives the forced enforcement
 * action (warn → kick → ban).
 *
 * Escalation policy (per offending user, see `moderation.constants.ts`):
 *  - `minor` label (CSAM-risk) ⇒ INSTANT PERMANENT BAN, evidence retained, row
 *    flagged for human review — zero tolerance, regardless of score/history;
 *  - a single high-confidence frame (`score ≥ HIGH_SCORE_THRESHOLD`) ⇒ BAN;
 *  - otherwise count this user's violations within {@link ESCALATION_WINDOW_MS}:
 *    1st ⇒ `warn`, 2nd ⇒ `kick` (end current match), 3rd+ ⇒ `ban`.
 *
 * Enforcement is decoupled from the realtime gateway to avoid a module cycle
 * (`MatchmakingModule` already imports `ModerationModule`): a `kick`/`ban`
 * action is PUBLISHED on {@link MODERATION_ACTION_CHANNEL}; the matchmaking
 * gateway subscribes and emits `mod:action` + ends the call. A `ban`
 * additionally calls {@link AdminService.banUser}, which flips `isBanned` (read
 * by `WsAuthService.isBanned`), revokes sessions and force-disconnects sockets
 * cluster-wide via the existing `user:disconnect` channel.
 */
@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    @InjectModel(ModerationEvent.name)
    private readonly eventModel: Model<ModerationEventDocument>,
    @Inject(FRAME_SCORER) private readonly frameScorer: FrameScorer,
    private readonly adminService: AdminService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Handle one reported violation for `userId`: optionally re-score the evidence
   * server-side (taking the stronger of client vs server signal), persist the
   * event, decide the escalation action, ban if warranted and publish the forced
   * action to the gateway. Returns the {@link ModerationActionPayload} taken.
   *
   * Never throws on a transient failure of a non-critical step (re-score,
   * publish): persistence + the ban side-effect are what make enforcement real.
   */
  async handleViolation(
    userId: string,
    dto: ModerationViolationDto,
  ): Promise<ModerationActionPayload> {
    // 1) Optional server-side spot-check. Take the MORE severe of the two
    //    signals: a 'safe'/low server score never downgrades a client report,
    //    but a confident server label/score can upgrade it.
    const server = await this.safeScore(dto.evidence);
    const { label, score } = mergeSignals({ label: dto.label, score: dto.score }, server);

    // 2) Decide the action FIRST (count prior events), so the row we persist
    //    records the action actually taken.
    const decision = await this.decide(userId, label, score);

    // 3) Persist the event (audit log + review queue). 'minor' and any ban are
    //    flagged 'reviewing' so they surface at the top of the human queue;
    //    everything else is 'open'.
    const flaggedForReview = decision.permanent || decision.ban;
    await this.persistEvent(userId, dto, label, score, decision.action, flaggedForReview);

    // 4) Apply the ban side-effect (idempotent) before announcing it, so by the
    //    time the client/sockets react the account is already un-authable.
    if (decision.ban) {
      try {
        await this.adminService.banUser(userId);
      } catch (err) {
        this.logger.error(`Failed to ban user ${userId} after violation: ${asMessage(err)}`);
      }
    }

    // 5) Build + announce the forced action.
    const payload = this.buildPayload(decision, label);
    if (decision.action === 'kick' || decision.action === 'ban') {
      await this.publishAction(userId, payload);
    }
    return payload;
  }

  /**
   * Ingest a mobile `client-signal` (the lighter-weight on-device NSFW push:
   * a per-class aggregate, no evidence frame). We MAP the aggregate score
   * onto the standard `(label, score)` shape and reuse {@link handleViolation}
   * so the escalation policy + persistence + delivery path are EXACTLY the
   * same as a `/moderation/frame` report. The signal is dropped (returns
   * `none`) below the conservative client-signal threshold so a noisy stream
   * never tips a user into escalation without a real violation.
   *
   * Aggregate = `porn + hentai + sexy`. The dominant per-class score (when
   * provided) chooses between `sexual` (porn/hentai) and `nudity` (sexy),
   * mirroring the on-device class→label mapping in
   * `apps/mobile/lib/features/roulette/data/nsfw_classifier.dart` and the
   * web's `apps/web/src/features/moderation/classifier.ts`.
   */
  async handleClientSignal(
    userId: string,
    dto: ClientSignalDto,
  ): Promise<ModerationActionPayload> {
    // Conservative floor — anything below this is noise. Tunable here so
    // operators can tighten without touching the controller.
    const CLIENT_SIGNAL_FLOOR = 0.7;
    if (dto.aggregate < CLIENT_SIGNAL_FLOOR) {
      return { action: 'none', label: 'safe' };
    }

    const scores = dto.scores ?? {};
    const porn = scores.porn ?? 0;
    const hentai = scores.hentai ?? 0;
    const sexy = scores.sexy ?? 0;
    const strongestSexual = porn > hentai ? porn : hentai;

    const label: ModerationLabel =
      strongestSexual >= sexy ? 'sexual' : 'nudity';

    // Reuse the violation pipeline. There's no evidence frame on the
    // client-signal channel — the persisted row records the signal score and
    // the auto-action it triggered, with `evidenceUrl` = null.
    return this.handleViolation(userId, {
      matchId: dto.matchId,
      label,
      score: dto.aggregate,
      // evidence omitted — client-signal is the no-frame path.
    });
  }

  // ── Escalation policy ────────────────────────────────────────────────────────

  /**
   * Decide the action for a violation. Order matters: zero-tolerance label →
   * high-score single-strike → count-based warn/kick/ban. The current event is
   * included in the count (we add 1 to prior events in the window).
   */
  private async decide(
    userId: string,
    label: ModerationLabel,
    score: number,
  ): Promise<EscalationDecision> {
    // Zero-tolerance (CSAM): instant permanent ban regardless of score/history.
    if (ZERO_TOLERANCE_LABELS.includes(label)) {
      return {
        action: 'ban',
        reason: 'Zero-tolerance violation (child-safety). This is permanent.',
        ban: true,
        permanent: true,
      };
    }

    // A single high-confidence violation is severe enough to ban outright.
    if (score >= HIGH_SCORE_THRESHOLD) {
      return {
        action: 'ban',
        reason: 'High-confidence policy violation.',
        ban: true,
        permanent: false,
      };
    }

    // Count-based escalation: this event's ordinal = prior-in-window + 1.
    const priorCount = await this.countRecentViolations(userId);
    const strike = priorCount + 1;

    if (strike >= BAN_AT_VIOLATION) {
      return {
        action: 'ban',
        reason: 'Repeated policy violations.',
        ban: true,
        permanent: false,
      };
    }
    if (strike >= KICK_AT_VIOLATION) {
      return {
        action: 'kick',
        reason: 'Policy violation — you have been removed from this call.',
        ban: false,
        permanent: false,
      };
    }
    return {
      action: 'warn',
      reason: 'Policy violation detected. Continued violations will remove or ban you.',
      ban: false,
      permanent: false,
    };
  }

  /**
   * Count this user's prior violations within the rolling escalation window.
   * A moderator-`dismissed` event was reviewed and cleared (a false positive),
   * so it must NOT count toward escalation — excluding it prevents wrongly
   * escalating a user on the strength of a flag a human already overturned.
   */
  private async countRecentViolations(userId: string): Promise<number> {
    if (!Types.ObjectId.isValid(userId)) {
      return 0;
    }
    const since = new Date(Date.now() - ESCALATION_WINDOW_MS);
    return this.eventModel
      .countDocuments({
        userId: new Types.ObjectId(userId),
        createdAt: { $gte: since },
        status: { $ne: 'dismissed' },
      })
      .exec();
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  /** Persist the violation as a review-queue event with retained evidence. */
  private async persistEvent(
    userId: string,
    dto: ModerationViolationDto,
    label: ModerationLabel,
    score: number,
    autoAction: ModerationAction,
    flaggedForReview: boolean,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) {
      // Caller is JWT-authenticated, so this should not happen; guard anyway.
      this.logger.warn(`Skipping moderation event for invalid userId: ${userId}`);
      return;
    }
    await this.eventModel.create({
      userId: new Types.ObjectId(userId),
      matchId:
        dto.matchId && Types.ObjectId.isValid(dto.matchId) ? new Types.ObjectId(dto.matchId) : null,
      label,
      score,
      evidenceUrl: dto.evidence ?? null,
      autoAction,
      status: flaggedForReview ? 'reviewing' : 'open',
    });
  }

  // ── Enforcement delivery ───────────────────────────────────────────────────────

  /**
   * Publish the forced action so the realtime gateway holding the user's socket
   * emits `mod:action` and ends their active call. Best-effort: a ban is already
   * effective via {@link AdminService.banUser}; this only delivers the reason +
   * tears down the live call faster.
   */
  private async publishAction(userId: string, payload: ModerationActionPayload): Promise<void> {
    const message: ModerationActionMessage = { userId, payload };
    try {
      await this.redis.publish(MODERATION_ACTION_CHANNEL, JSON.stringify(message));
    } catch (err) {
      this.logger.warn(`Failed to publish moderation action for ${userId}: ${asMessage(err)}`);
    }
  }

  /** Build the client-facing payload from a decision. */
  private buildPayload(
    decision: EscalationDecision,
    label: ModerationLabel,
  ): ModerationActionPayload {
    return {
      action: decision.action,
      label,
      reason: decision.reason,
      // Permanent bans omit `banExpiresAt`. Policy-temporary bans are enforced by
      // the `isBanned` flag (manual/ops unban); we do not auto-expire here, so we
      // omit the timestamp to avoid implying a self-lifting ban the code doesn't do.
    };
  }

  // ── Server-side scoring (optional) ─────────────────────────────────────────────

  /** Run the configured {@link FrameScorer}, swallowing any failure to safe/0. */
  private async safeScore(
    evidence: string | undefined,
  ): Promise<{ label: ModerationLabel; score: number }> {
    try {
      return await this.frameScorer.score(evidence);
    } catch (err) {
      this.logger.warn(`Frame scorer threw: ${asMessage(err)}`);
      return { label: 'safe', score: 0 };
    }
  }
}

/**
 * Severity rank of each label, low → high. The merge prefers the MORE SEVERE
 * label first (a `minor`/CSAM spot-check must win over a `nudity` report even at
 * a lower confidence), and only falls back to the higher score when both signals
 * carry the SAME-severity label. `safe` is the floor and can never win.
 */
const LABEL_SEVERITY: Record<ModerationLabel, number> = {
  safe: 0,
  other: 1,
  nudity: 2,
  sexual: 3,
  violence: 3,
  minor: 4,
};

/**
 * Combine the client-reported signal with the server's spot-check. We never let
 * a `safe` / weaker server result downgrade a client report (defence-in-depth:
 * the client's on-device model is the primary detector). The server upgrades the
 * signal when it is non-`safe` AND either:
 *   - it carries a STRICTLY MORE SEVERE label (e.g. server `minor` over client
 *     `nudity`), regardless of score — a worse category outranks raw confidence; or
 *   - it carries the same-severity label with a strictly higher score.
 * Otherwise the client signal stands.
 */
function mergeSignals(
  client: { label: ModerationLabel; score: number },
  server: { label: ModerationLabel; score: number },
): { label: ModerationLabel; score: number } {
  if (server.label === 'safe') {
    return client;
  }
  const serverSeverity = LABEL_SEVERITY[server.label] ?? 0;
  const clientSeverity = LABEL_SEVERITY[client.label] ?? 0;
  if (serverSeverity > clientSeverity) {
    return server;
  }
  if (serverSeverity === clientSeverity && server.score > client.score) {
    return server;
  }
  return client;
}

/** Narrows an unknown thrown value to a printable message. */
function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
