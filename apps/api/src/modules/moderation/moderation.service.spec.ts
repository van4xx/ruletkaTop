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

  it('counts prior violations EXCLUDING dismissed (cleared false-positives never escalate)', async () => {
    withPriorViolations(0);

    await service.handleViolation(USER, violation());

    // The escalation count must skip moderator-`dismissed` events.
    const [filter] = eventModel.countDocuments.mock.calls[0] as [Record<string, unknown>];
    expect(filter.status).toEqual({ $ne: 'dismissed' });
    expect(filter).toMatchObject({
      createdAt: expect.objectContaining({ $gte: expect.any(Date) }),
    });
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

  it("label 'minor' (CSAM) → forces force-logout/disconnect via adminService.banUser (kills all active sessions NOW)", async () => {
    // The minor-label path MUST drive an immediate session teardown of the
    // offender (not merely flip `isBanned` so they're blocked on NEXT login).
    // The full chain — revokeAllSessions + cluster-wide socket disconnect —
    // lives inside AdminService.banUser; here we assert the moderation engine
    // INVOKES that hook on the minor path so the chain is wired through.
    withPriorViolations(0);

    await service.handleViolation(USER, violation({ label: 'minor', score: 0.1 }));

    // banUser is the single force-logout entry point: it revokes every refresh
    // session AND publishes to USER_DISCONNECT_CHANNEL so live sockets drop
    // cluster-wide. The minor path must call it exactly once with the offender id.
    expect(adminService.banUser).toHaveBeenCalledTimes(1);
    expect(adminService.banUser).toHaveBeenCalledWith(USER);

    // And the published `mod:action` for the ban must be the LAST step (after
    // banUser has resolved), so the client/sockets only observe the announce
    // AFTER the account is un-authable. Order: banUser → publish.
    const banOrder = adminService.banUser.mock.invocationCallOrder[0]!;
    const publishOrder = redis.publish.mock.invocationCallOrder[0]!;
    expect(banOrder).toBeLessThan(publishOrder);
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

  it('a MORE-SEVERE server label upgrades a HIGHER-score client report (severity beats score)', async () => {
    withPriorViolations(0);
    // Server detects CSAM ('minor') at a LOWER score than the client's 'nudity'.
    // Severity must win: the merged signal is the zero-tolerance 'minor' → ban.
    frameScorer.score.mockResolvedValue({ label: 'minor', score: 0.55 });

    const action = await service.handleViolation(USER, violation({ label: 'nudity', score: 0.9 }));

    expect(action.label).toBe('minor');
    expect(action.action).toBe('ban');
    // Zero-tolerance short-circuits before counting prior violations.
    expect(eventModel.countDocuments).not.toHaveBeenCalled();
  });

  it('a LOWER-severity server label does NOT override a more-severe client report', async () => {
    withPriorViolations(0);
    // Server says 'nudity' (less severe) at a high score; client reported 'minor'.
    frameScorer.score.mockResolvedValue({ label: 'nudity', score: 0.99 });

    const action = await service.handleViolation(USER, violation({ label: 'minor', score: 0.3 }));

    // The more-severe client label stands (server cannot downgrade severity).
    expect(action.label).toBe('minor');
    expect(action.action).toBe('ban');
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
