import type { Redis } from 'ioredis';

import { MetricsService } from './metrics.service';

/**
 * Exercises the REAL prom-client registry (not a mock) to prove the new
 * background-sweep counters register on the dedicated registry and render in
 * Prometheus exposition format with the expected `{queue}` label.
 */
describe('MetricsService — queue counters', () => {
  let service: MetricsService;

  beforeEach(() => {
    // The only Redis touchpoint is the queue-depth gauge's pull-style `collect`,
    // invoked on render(); a resolving zcard keeps render() clean.
    const redis = { zcard: jest.fn().mockResolvedValue(0) } as unknown as Redis;
    service = new MetricsService(redis);
  });

  it('renders ruletka_queue_jobs_failed_total{queue} after a failure is recorded', async () => {
    service.queueJobFailed('subscription-sweep');
    service.queueJobFailed('subscription-sweep');

    const body = await service.render();
    expect(body).toContain('ruletka_queue_jobs_failed_total');
    expect(body).toMatch(/ruletka_queue_jobs_failed_total\{queue="subscription-sweep"\}\s+2/);
  });

  it('renders ruletka_queue_jobs_completed_total{queue} after a completion', async () => {
    service.queueJobCompleted('top-sweep');

    const body = await service.render();
    expect(body).toMatch(/ruletka_queue_jobs_completed_total\{queue="top-sweep"\}\s+1/);
  });

  it('renders ruletka_queue_register_failures_total{queue} after a boot failure', async () => {
    service.queueRegisterFailed('match-reconcile');

    const body = await service.render();
    expect(body).toMatch(/ruletka_queue_register_failures_total\{queue="match-reconcile"\}\s+1/);
  });

  it('keeps per-queue counters isolated (one queue failing does not bump another)', async () => {
    service.queueJobFailed('top-sweep');

    const body = await service.render();
    expect(body).toMatch(/ruletka_queue_jobs_failed_total\{queue="top-sweep"\}\s+1/);
    // A queue that never failed should not appear with a non-zero sample.
    expect(body).not.toMatch(/ruletka_queue_jobs_failed_total\{queue="subscription-sweep"\}/);
  });
});
