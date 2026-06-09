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

/**
 * Exercises the REAL registry for the security/abuse/money counters added in the
 * observability pass: each bump renders in Prometheus exposition format with the
 * expected (low-cardinality, closed-enum) label — and no high-cardinality label.
 */
describe('MetricsService — security / abuse / money counters', () => {
  let service: MetricsService;

  beforeEach(() => {
    const redis = { zcard: jest.fn().mockResolvedValue(0) } as unknown as Redis;
    service = new MetricsService(redis);
  });

  it('renders ruletka_auth_login_failed_total / _locked_total (label-free) after bumps', async () => {
    service.loginFailed();
    service.loginFailed();
    service.loginLocked();

    const body = await service.render();
    // Label-free counters: the email/ip is NEVER a Prometheus label (cardinality).
    expect(body).toMatch(/ruletka_auth_login_failed_total\s+2/);
    expect(body).toMatch(/ruletka_auth_login_locked_total\s+1/);
  });

  it('renders ruletka_webhook_signature_failures_total{provider} after a rejection', async () => {
    service.webhookSignatureFailed('cloudpayments');

    const body = await service.render();
    expect(body).toMatch(
      /ruletka_webhook_signature_failures_total\{provider="cloudpayments"\}\s+1/,
    );
  });

  it('renders ruletka_payments_completed_total{purpose} per purpose', async () => {
    service.paymentCompleted('coins');
    service.paymentCompleted('premium');
    service.paymentCompleted('coins');

    const body = await service.render();
    expect(body).toMatch(/ruletka_payments_completed_total\{purpose="coins"\}\s+2/);
    expect(body).toMatch(/ruletka_payments_completed_total\{purpose="premium"\}\s+1/);
  });

  it('renders ruletka_payments_failed_total / _refunds_total (label-free) after bumps', async () => {
    service.paymentFailed();
    service.refundRecorded();
    service.refundRecorded();

    const body = await service.render();
    expect(body).toMatch(/ruletka_payments_failed_total\s+1/);
    expect(body).toMatch(/ruletka_refunds_total\s+2/);
  });

  it('renders ruletka_fulfilment_rollback_total{purpose} (the paid-but-not-entitled PAGE signal)', async () => {
    service.fulfilmentRolledBack('coins');

    const body = await service.render();
    expect(body).toMatch(/ruletka_fulfilment_rollback_total\{purpose="coins"\}\s+1/);
  });

  it('renders ruletka_bans_total / ruletka_unbans_total after sanctions', async () => {
    service.banApplied();
    service.banApplied();
    service.banLifted();

    const body = await service.render();
    expect(body).toMatch(/ruletka_bans_total\s+2/);
    expect(body).toMatch(/ruletka_unbans_total\s+1/);
  });
});
