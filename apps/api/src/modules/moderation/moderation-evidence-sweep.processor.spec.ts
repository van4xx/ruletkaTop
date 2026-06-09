import type { Job, Queue } from 'bullmq';

import type { MetricsService } from '../../observability/metrics.service';
import { SWEEP_KEEP_FAILED } from '../../observability/sweep-job';
import {
  MODERATION_EVIDENCE_SWEEP_QUEUE,
  ModerationEvidenceSweepProcessor,
} from './moderation-evidence-sweep.processor';
import type { ReportsService } from './reports.service';
import type { ReviewService } from './review.service';

/**
 * Resilience/observability contract for the abuse-evidence retention sweep
 * (mirrors the subscription sweep):
 * - a failed job bumps `ruletka_queue_jobs_failed_total{queue}` and logs at error;
 * - the repeatable job is registered with BOUNDED retention + retry so failures
 *   stay inspectable;
 * - a boot-time Redis blip degrades (metric + error log) without throwing;
 * - one pass purges BOTH the report and the moderation-event evidence.
 */
describe('ModerationEvidenceSweepProcessor (resilience)', () => {
  let queue: { add: jest.Mock };
  let reports: { sweepExpiredEvidence: jest.Mock };
  let review: { sweepExpiredEvidence: jest.Mock };
  let metrics: {
    queueJobFailed: jest.Mock;
    queueJobCompleted: jest.Mock;
    queueRegisterFailed: jest.Mock;
  };
  let processor: ModerationEvidenceSweepProcessor;

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    reports = { sweepExpiredEvidence: jest.fn().mockResolvedValue(2) };
    review = { sweepExpiredEvidence: jest.fn().mockResolvedValue(3) };
    metrics = {
      queueJobFailed: jest.fn(),
      queueJobCompleted: jest.fn(),
      queueRegisterFailed: jest.fn(),
    };
    processor = new ModerationEvidenceSweepProcessor(
      queue as unknown as Queue,
      reports as unknown as ReportsService,
      review as unknown as ReviewService,
      metrics as unknown as MetricsService,
    );
    // Silence the loud error/warn/log lines the resilience paths emit on purpose.
    jest
      .spyOn((processor as unknown as { logger: { error: () => void } }).logger, 'error')
      .mockImplementation(() => undefined);
    jest
      .spyOn((processor as unknown as { logger: { warn: () => void } }).logger, 'warn')
      .mockImplementation(() => undefined);
    jest
      .spyOn((processor as unknown as { logger: { log: () => void } }).logger, 'log')
      .mockImplementation(() => undefined);
  });

  it('process purges BOTH report and moderation-event evidence', async () => {
    const res = await processor.process({} as Job);
    expect(reports.sweepExpiredEvidence).toHaveBeenCalledTimes(1);
    expect(review.sweepExpiredEvidence).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ reports: 2, events: 3 });
  });

  it('failed handler bumps the per-queue failure counter and logs at error', () => {
    const job = { id: 'job-1', name: 'purge-expired-evidence' } as unknown as Job;
    const logger = (processor as unknown as { logger: { error: jest.Mock } }).logger;

    processor.onFailed(job, new Error('mongo timeout'));

    expect(metrics.queueJobFailed).toHaveBeenCalledTimes(1);
    expect(metrics.queueJobFailed).toHaveBeenCalledWith(MODERATION_EVIDENCE_SWEEP_QUEUE);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const msg = (logger.error as jest.Mock).mock.calls[0][0] as string;
    expect(msg).toContain('job-1');
    expect(msg).toContain('mongo timeout');
  });

  it('failed handler tolerates an undefined job (BullMQ may pass none)', () => {
    expect(() => processor.onFailed(undefined, new Error('boom'))).not.toThrow();
    expect(metrics.queueJobFailed).toHaveBeenCalledWith(MODERATION_EVIDENCE_SWEEP_QUEUE);
  });

  it('completed handler bumps the per-queue completion counter', () => {
    processor.onCompleted();
    expect(metrics.queueJobCompleted).toHaveBeenCalledWith(MODERATION_EVIDENCE_SWEEP_QUEUE);
  });

  it('registers the repeatable job with BOUNDED retention + retry (not removeOnFail:true)', async () => {
    await processor.onModuleInit();

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [, , opts] = queue.add.mock.calls[0];
    expect(opts.removeOnFail).toBe(SWEEP_KEEP_FAILED);
    expect(opts.removeOnFail).not.toBe(true);
    expect(typeof opts.removeOnFail).toBe('number');
    expect(opts.attempts).toBeGreaterThanOrEqual(2);
    expect(opts.backoff).toMatchObject({ type: 'exponential' });
    expect(opts.repeat).toMatchObject({ every: expect.any(Number) });
    expect(opts.jobId).toBe('purge-expired-evidence');
    expect(metrics.queueRegisterFailed).not.toHaveBeenCalled();
  });

  it('boot registration degrades (metric + no throw) when Redis is down', async () => {
    queue.add.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(processor.onModuleInit()).resolves.toBeUndefined();

    expect(queue.add.mock.calls.length).toBeGreaterThan(1);
    expect(metrics.queueRegisterFailed).toHaveBeenCalledWith(MODERATION_EVIDENCE_SWEEP_QUEUE);
  });
});
