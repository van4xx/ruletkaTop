import type { Job, Queue } from 'bullmq';

import type { MetricsService } from '../../observability/metrics.service';
import { SWEEP_KEEP_FAILED } from '../../observability/sweep-job';
import type { MatchService } from './match.service';
import { MATCH_RECONCILE_QUEUE, MatchReconcileProcessor } from './match-reconcile.processor';

/** Resilience/observability contract for the stale-match reconciliation sweep. */
describe('MatchReconcileProcessor (resilience)', () => {
  let queue: { add: jest.Mock };
  let match: { reconcileStale: jest.Mock };
  let metrics: {
    queueJobFailed: jest.Mock;
    queueJobCompleted: jest.Mock;
    queueRegisterFailed: jest.Mock;
  };
  let processor: MatchReconcileProcessor;

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    match = { reconcileStale: jest.fn().mockResolvedValue(0) };
    metrics = {
      queueJobFailed: jest.fn(),
      queueJobCompleted: jest.fn(),
      queueRegisterFailed: jest.fn(),
    };
    processor = new MatchReconcileProcessor(
      queue as unknown as Queue,
      match as unknown as MatchService,
      metrics as unknown as MetricsService,
    );
    jest.spyOn((processor as unknown as { logger: { error: () => void } }).logger, 'error').mockImplementation(() => undefined);
    jest.spyOn((processor as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((processor as unknown as { logger: { log: () => void } }).logger, 'log').mockImplementation(() => undefined);
  });

  it('failed handler bumps the match-reconcile failure counter and logs at error', () => {
    const job = { id: 'job-3', name: 'close-stale-active' } as unknown as Job;
    const logger = (processor as unknown as { logger: { error: jest.Mock } }).logger;

    processor.onFailed(job, new Error('boom'));

    expect(metrics.queueJobFailed).toHaveBeenCalledWith(MATCH_RECONCILE_QUEUE);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('completed handler bumps the match-reconcile completion counter', () => {
    processor.onCompleted();
    expect(metrics.queueJobCompleted).toHaveBeenCalledWith(MATCH_RECONCILE_QUEUE);
  });

  it('registers with bounded retention (removeOnFail is a count, not true)', async () => {
    await processor.onModuleInit();
    const [, , opts] = queue.add.mock.calls[0];
    expect(opts.removeOnFail).toBe(SWEEP_KEEP_FAILED);
    expect(opts.removeOnFail).not.toBe(true);
  });

  it('boot registration degrades without throwing when enqueue fails', async () => {
    queue.add.mockRejectedValue(new Error('redis down'));
    await expect(processor.onModuleInit()).resolves.toBeUndefined();
    expect(metrics.queueRegisterFailed).toHaveBeenCalledWith(MATCH_RECONCILE_QUEUE);
  });
});
