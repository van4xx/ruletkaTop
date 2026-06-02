import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import type { MatchEndReason, MatchFilters, MatchType } from '@ruletka/shared-types';

import { Match, type MatchDocument } from './schemas/match.schema';

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

  /** Cheap guard so an obviously-malformed id never reaches the database. */
  private isValidObjectId(id: string): boolean {
    return /^[0-9a-fA-F]{24}$/.test(id);
  }
}
