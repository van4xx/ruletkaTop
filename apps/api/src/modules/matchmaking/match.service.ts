import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import type { MatchEndReason, MatchFilters, MatchType } from '@ruletka/shared-types';

import { ROOM_TTL_SECONDS } from './matchmaking.constants';
import { Match, type MatchDocument } from './schemas/match.schema';

/**
 * A still-`active` match (`endedAt === null`) older than this is considered
 * abandoned and is force-closed by the reconciliation sweep. Anchored to the
 * Redis room TTL ({@link ROOM_TTL_SECONDS}, the hard ceiling on a live room's
 * life) plus a margin, so the sweep only ever touches rows whose underlying
 * room has provably already been reaped — never a call that could still be
 * legitimately live.
 */
export const MATCH_STALE_AFTER_MS = (ROOM_TTL_SECONDS + 30 * 60) * 1000;

/**
 * Owns the persistent {@link Match} log — the analytics record of every
 * roulette pairing. EXPORTED for cross-module use (the gateway writes a row on
 * pairing and closes it on teardown; moderation/analytics read it).
 *
 * Live room/queue state is NOT kept here — that is Redis-backed on the gateway.
 * This service only deals with the durable audit trail.
 */
@Injectable()
export class MatchService {
  private readonly logger = new Logger(MatchService.name);

  constructor(@InjectModel(Match.name) private readonly matchModel: Model<MatchDocument>) {}

  /**
   * Records a new pairing and returns its id (hex string). Called the instant
   * two compatible peers are found, before signaling begins.
   *
   * @param userA first participant (the waiter)
   * @param userB second participant (the joiner)
   * @param type  media modality
   * @param filters the joiner's filter snapshot at match time
   */
  async createMatch(
    userA: string,
    userB: string,
    type: MatchType,
    filters: MatchFilters,
  ): Promise<string> {
    const doc = await this.matchModel.create({
      userA,
      userB,
      type,
      startedAt: new Date(),
      endedAt: null,
      endReason: null,
      filtersSnapshot: {
        gender: filters.gender,
        ageMin: filters.ageMin,
        ageMax: filters.ageMax,
        countries: filters.countries,
      },
    });
    return doc.id;
  }

  /**
   * Closes an open match, stamping `endedAt`/`endReason`. Idempotent: a match
   * already closed (or never persisted) is left untouched, so duplicate
   * teardown signals (peer hangup + disconnect racing) are safe.
   *
   * @returns the match duration in milliseconds, or `null` if nothing was
   *   updated (already ended / unknown id).
   */
  async endMatch(matchId: string, reason: MatchEndReason): Promise<number | null> {
    if (!this.isValidObjectId(matchId)) {
      return null;
    }

    const endedAt = new Date();
    const updated = await this.matchModel
      .findOneAndUpdate(
        { _id: matchId, endedAt: null },
        { $set: { endedAt, endReason: reason } },
        { new: true },
      )
      .lean()
      .exec();

    if (!updated) {
      return null;
    }

    const durationMs = endedAt.getTime() - new Date(updated.startedAt).getTime();
    this.logger.debug(`Match ${matchId} ended (reason=${reason}, durationMs=${durationMs})`);
    return durationMs;
  }

  /**
   * RECONCILIATION SWEEP (called by the repeatable BullMQ job): force-close
   * every match still flagged `active` (`endedAt === null`) whose `startedAt` is
   * older than {@link MATCH_STALE_AFTER_MS}, stamping `endedAt = now` and
   * `endReason = 'timeout'`.
   *
   * The normal teardown path ({@link endMatch}) closes a match on hangup /
   * disconnect, but a crashed gateway, a lost final signal, or a hard process
   * kill can leave an open row with no clean close. Since a live room cannot
   * outlive {@link ROOM_TTL_SECONDS}, any still-open row older than that ceiling
   * (plus a margin) is provably abandoned, so closing it never races a real
   * call.
   *
   * Idempotent + safe on any cadence: the filter only matches `endedAt: null`
   * rows past the threshold, and the write sets `endedAt`, so a swept row falls
   * out of the next pass. Returns the number of matches reconciled.
   */
  async reconcileStale(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - MATCH_STALE_AFTER_MS);
    const reason: MatchEndReason = 'timeout';

    const res = await this.matchModel
      .updateMany(
        { endedAt: null, startedAt: { $lte: cutoff } },
        { $set: { endedAt: now, endReason: reason } },
      )
      .exec();

    const reconciled = res.modifiedCount ?? 0;
    if (reconciled > 0) {
      this.logger.warn(`Match reconciliation: force-closed ${reconciled} stale active match(es)`);
    }
    return reconciled;
  }

  /** Cheap guard so an obviously-malformed id never reaches the database. */
  private isValidObjectId(id: string): boolean {
    return /^[0-9a-fA-F]{24}$/.test(id);
  }
}
