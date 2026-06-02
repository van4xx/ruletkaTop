import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import type { ModerationViolationDto } from '@ruletka/shared-types';

import { REDIS_CLIENT } from '../../redis/redis.constants';
import { AdminService } from './admin.service';
import { FRAME_SCORER, type FrameScorer } from './frame-scorer';
import { MODERATION_ACTION_CHANNEL } from './moderation.constants';
import { ModerationService } from './moderation.service';
import { ModerationEvent } from './schemas/moderation-event.schema';

/** Chainable query stub whose `.exec()` resolves to `result`. */
function queryReturning(result: unknown): { exec: jest.Mock } {
  return { exec: jest.fn().mockResolvedValue(result) };
}

const USER = '507f1f77bcf86cd799439011';
const MATCH = '507f1f77bcf86cd799439099';

describe('ModerationService — escalation policy', () => {
  let service: ModerationService;
  let eventModel: { create: jest.Mock; countDocuments: jest.Mock };
  let frameScorer: jest.Mocked<FrameScorer>;
  let adminService: { banUser: jest.Mock };
  let redis: { publish: jest.Mock };

  /** Configure the prior-violations-in-window count the policy reads. */
  function withPriorViolations(n: number): void {
    eventModel.countDocuments.mockReturnValue(queryReturning(n));
  }

  beforeEach(async () => {
    eventModel = {
      create: jest.fn().mockResolvedValue({ _id: { toString: () => 'event-1' } }),
      countDocuments: jest.fn().mockReturnValue(queryReturning(0)),
    };
    // No-op scorer by default (server adds no signal); individual tests override.
    frameScorer = { score: jest.fn().mockResolvedValue({ label: 'safe', score: 0 }) };
    adminService = { banUser: jest.fn().mockResolvedValue({ userId: USER, isBanned: true }) };
    redis = { publish: jest.fn().mockResolvedValue(1) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ModerationService,
        { provide: getModelToken(ModerationEvent.name), useValue: eventModel },
        { provide: FRAME_SCORER, useValue: frameScorer },
        { provide: AdminService, useValue: adminService },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    service = moduleRef.get(ModerationService);
  });

  function violation(over: Partial<ModerationViolationDto> = {}): ModerationViolationDto {
    return { label: 'nudity', score: 0.5, matchId: MATCH, ...over };
  }

  it('1st strike (no prior) → warn; persists an open event; no ban, no publish', async () => {
    withPriorViolations(0);

    const action = await service.handleViolation(USER, violation());

    expect(action.action).toBe('warn');
    expect(adminService.banUser).not.toHaveBeenCalled();
    expect(redis.publish).not.toHaveBeenCalled(); // warn is not pushed mid-call

    // Event persisted with the action taken + retained context, status 'open'.
    expect(eventModel.create).toHaveBeenCalledTimes(1);
    const doc = eventModel.create.mock.calls[0][0] as Record<string, unknown>;
    expect(doc.autoAction).toBe('warn');
    expect(doc.status).toBe('open');
    expect(doc.label).toBe('nudity');
  });

  it('2nd strike (1 prior) → kick; ends the call via published action; no ban', async () => {
    withPriorViolations(1);

    const action = await service.handleViolation(USER, violation());

    expect(action.action).toBe('kick');
    expect(adminService.banUser).not.toHaveBeenCalled();

    // Kick is delivered to the gateway over the moderation-action channel.
    expect(redis.publish).toHaveBeenCalledTimes(1);
    const [channel, body] = redis.publish.mock.calls[0] as [string, string];
    expect(channel).toBe(MODERATION_ACTION_CHANNEL);
    const msg = JSON.parse(body) as { userId: string; payload: { action: string } };
    expect(msg.userId).toBe(USER);
    expect(msg.payload.action).toBe('kick');

    const doc = eventModel.create.mock.calls[0][0] as Record<string, unknown>;
    expect(doc.autoAction).toBe('kick');
  });

  it('3rd strike (2 prior) → ban; bans the account AND publishes the action', async () => {
    withPriorViolations(2);

    const action = await service.handleViolation(USER, violation());

    expect(action.action).toBe('ban');
    expect(adminService.banUser).toHaveBeenCalledTimes(1);
    expect(adminService.banUser).toHaveBeenCalledWith(USER);
    expect(redis.publish).toHaveBeenCalledTimes(1);

    // Ban events are flagged for human review.
    const doc = eventModel.create.mock.calls[0][0] as Record<string, unknown>;
    expect(doc.autoAction).toBe('ban');
    expect(doc.status).toBe('reviewing');
  });

  it("label 'minor' (CSAM) → instant permanent ban on the FIRST strike, regardless of score", async () => {
    withPriorViolations(0);

    const action = await service.handleViolation(USER, violation({ label: 'minor', score: 0.1 }));

    expect(action.action).toBe('ban');
    expect(action.label).toBe('minor');
    // Permanent ban omits an expiry hint.
    expect(action.banExpiresAt).toBeUndefined();
    expect(adminService.banUser).toHaveBeenCalledWith(USER);

    const doc = eventModel.create.mock.calls[0][0] as Record<string, unknown>;
    expect(doc.autoAction).toBe('ban');
    expect(doc.status).toBe('reviewing'); // flagged for review + evidence retained
    // Zero-tolerance must NOT depend on the prior-count query.
    expect(eventModel.countDocuments).not.toHaveBeenCalled();
  });

  it('high score (≥ threshold) on the FIRST strike → immediate ban (bypasses warn/kick)', async () => {
    withPriorViolations(0);

    const action = await service.handleViolation(USER, violation({ label: 'sexual', score: 0.95 }));

    expect(action.action).toBe('ban');
    expect(adminService.banUser).toHaveBeenCalledWith(USER);
    // High-score short-circuits before counting prior violations.
    expect(eventModel.countDocuments).not.toHaveBeenCalled();
  });

  it('retains the evidence frame on the persisted event', async () => {
    withPriorViolations(0);
    const evidence = 'data:image/jpeg;base64,AAAA';

    await service.handleViolation(USER, violation({ evidence }));

    const doc = eventModel.create.mock.calls[0][0] as Record<string, unknown>;
    expect(doc.evidenceUrl).toBe(evidence);
  });

  it('server frame-scorer can UPGRADE a weak client report (safe never downgrades)', async () => {
    withPriorViolations(0);
    // Client said low-confidence 'other'; server is highly confident it is sexual.
    frameScorer.score.mockResolvedValue({ label: 'sexual', score: 0.97 });

    const action = await service.handleViolation(USER, violation({ label: 'other', score: 0.2 }));

    // Upgraded to a high-score ban via the server signal.
    expect(action.action).toBe('ban');
    expect(action.label).toBe('sexual');
  });

  it('a failing ban side-effect still returns the ban action (does not throw)', async () => {
    withPriorViolations(2);
    adminService.banUser.mockRejectedValue(new Error('db down'));

    const action = await service.handleViolation(USER, violation());

    expect(action.action).toBe('ban');
    // The event is still persisted even though the ban write failed.
    expect(eventModel.create).toHaveBeenCalledTimes(1);
  });

  it('a failing publish does not break the action result (best-effort delivery)', async () => {
    withPriorViolations(1);
    redis.publish.mockRejectedValue(new Error('redis down'));

    const action = await service.handleViolation(USER, violation());

    expect(action.action).toBe('kick');
  });
});
