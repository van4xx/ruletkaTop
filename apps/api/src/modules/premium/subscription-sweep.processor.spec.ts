import type { Job, Queue } from 'bullmq';

import type { MetricsService } from '../../observability/metrics.service';
import { SWEEP_KEEP_FAILED } from '../../observability/sweep-job';
import type { PremiumService } from './premium.service';
import { SUBSCRIPTION_SWEEP_QUEUE, SubscriptionSweepProcessor } from './subscription-sweep.processor';

/**
 * Resilience/observability contract for the subscription expiry sweep:
 * - a failed job bumps `ruletka_queue_jobs_failed_total{queue}` and logs at error;
 * - the repeatable job is registered with BOUNDED retention (removeOnFail is a
 *   count, never `true`) + bounded retry, so failures stay inspectable;
 * - a boot-time Redis blip degrades (metric + error log) without throwing.
 */
describe('SubscriptionSweepProcessor (resilience)', () => {
  let queue: { add: jest.Mock };
  let premium: { sweepExpired: jest.Mock };
  let metrics: {
    queueJobFailed: jest.Mock;
    queueJobCompleted: jest.Mock;
    queueRegisterFailed: jest.Mock;
  };
  let processor: SubscriptionSweepProcessor;

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    premium = { sweepExpired: jest.fn().mockResolvedValue(2) };
    metrics = {
      queueJobFailed: jest.fn(),
      queueJobCompleted: jest.fn(),
      queueRegisterFailed: jest.fn(),
    };
    processor = new SubscriptionSweepProcessor(
      queue as unknown as Queue,
      premium as unknown as PremiumService,
      metrics as unknown as MetricsService,
    );
    // Silence the loud error/warn logs the resilience paths emit on purpose.
    jest.spyOn((processor as unknown as { logger: { error: () => void } }).logger, 'error').mockImplementation(() => undefined);
    jest.spyOn((processor as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((processor as unknown as { logger: { log: () => void } }).logger, 'log').mockImplementation(() => undefined);
  });

  it('failed handler bumps the per-queue failure counter and logs at error', () => {
    const job = { id: 'job-1', name: 'expire-lapsed' } as unknown as Job;
    const logger = (processor as unknown as { logger: { error: jest.Mock } }).logger;

    processor.onFailed(job, new Error('mongo timeout'));

    expect(metrics.queueJobFailed).toHaveBeenCalledTimes(1);
    expect(metrics.queueJobFailed).toHaveBeenCalledWith(SUBSCRIPTION_SWEEP_QUEUE);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const msg = (logger.error as jest.Mock).mock.calls[0][0] as string;
    expect(msg).toContain('job-1');
    expect(msg).toContain('mongo timeout');
  });

  it('failed handler tolerates an undefined job (BullMQ may pass none)', () => {
    expect(() => processor.onFailed(undefined, new Error('boom'))).not.toThrow();
    expect(metrics.queueJobFailed).toHaveBeenCalledWith(SUBSCRIPTION_SWEEP_QUEUE);
  });

  it('completed handler bumps the per-queue completion counter', () => {
    processor.onCompleted();
    expect(metrics.queueJobCompleted).toHaveBeenCalledWith(SUBSCRIPTION_SWEEP_QUEUE);
  });

  it('registers the repeatable job with BOUNDED retention + retry (not removeOnFail:true)', async () => {
    await processor.onModuleInit();

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [, , opts] = queue.add.mock.calls[0];
    // Retention is a bounded COUNT so a permanently-failed job stays inspectable.
    expect(opts.removeOnFail).toBe(SWEEP_KEEP_FAILED);
    expect(opts.removeOnFail).not.toBe(true);
    expect(typeof opts.removeOnFail).toBe('number');
    // Bounded retry + backoff.
    expect(opts.attempts).toBeGreaterThanOrEqual(2);
    expect(opts.backoff).toMatchObject({ type: 'exponential' });
    // Stable repeat schedule.
    expect(opts.repeat).toMatchObject({ every: expect.any(Number) });
    expect(opts.jobId).toBe('expire-lapsed');
    expect(metrics.queueRegisterFailed).not.toHaveBeenCalled();
  });

  it('boot registration degrades (metric + no throw) when Redis is down', async () => {
    queue.add.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(processor.onModuleInit()).resolves.toBeUndefined();

    // Retried, then surfaced loudly via the register-failure counter — never crashed.
    expect(queue.add.mock.calls.length).toBeGreaterThan(1);
    expect(metrics.queueRegisterFailed).toHaveBeenCalledWith(SUBSCRIPTION_SWEEP_QUEUE);
  });
});
