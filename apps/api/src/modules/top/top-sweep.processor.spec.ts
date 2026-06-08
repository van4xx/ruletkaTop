import type { Job, Queue } from 'bullmq';

import type { MetricsService } from '../../observability/metrics.service';
import { SWEEP_KEEP_FAILED } from '../../observability/sweep-job';
import type { TopService } from './top.service';
import { TOP_SWEEP_QUEUE, TopSweepProcessor } from './top-sweep.processor';

/** Resilience/observability contract for the top-placement expiry sweep. */
describe('TopSweepProcessor (resilience)', () => {
  let queue: { add: jest.Mock };
  let top: { sweepExpired: jest.Mock };
  let metrics: {
    queueJobFailed: jest.Mock;
    queueJobCompleted: jest.Mock;
    queueRegisterFailed: jest.Mock;
  };
  let processor: TopSweepProcessor;

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    top = { sweepExpired: jest.fn().mockResolvedValue(0) };
    metrics = {
      queueJobFailed: jest.fn(),
      queueJobCompleted: jest.fn(),
      queueRegisterFailed: jest.fn(),
    };
    processor = new TopSweepProcessor(
      queue as unknown as Queue,
      top as unknown as TopService,
      metrics as unknown as MetricsService,
    );
    jest.spyOn((processor as unknown as { logger: { error: () => void } }).logger, 'error').mockImplementation(() => undefined);
    jest.spyOn((processor as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((processor as unknown as { logger: { log: () => void } }).logger, 'log').mockImplementation(() => undefined);
  });

  it('failed handler bumps the top-sweep failure counter and logs at error', () => {
    const job = { id: 'job-9', name: 'expire-placements' } as unknown as Job;
    const logger = (processor as unknown as { logger: { error: jest.Mock } }).logger;

    processor.onFailed(job, new Error('boom'));

    expect(metrics.queueJobFailed).toHaveBeenCalledWith(TOP_SWEEP_QUEUE);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('completed handler bumps the top-sweep completion counter', () => {
    processor.onCompleted();
    expect(metrics.queueJobCompleted).toHaveBeenCalledWith(TOP_SWEEP_QUEUE);
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
    expect(metrics.queueRegisterFailed).toHaveBeenCalledWith(TOP_SWEEP_QUEUE);
  });
});
