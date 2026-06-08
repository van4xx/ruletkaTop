import { HttpStatus } from '@nestjs/common';
import type { Connection } from 'mongoose';
import type { Redis } from 'ioredis';
import type { Response } from 'express';

import { HealthController } from './health.controller';

/**
 * HealthController unit tests.
 *
 * Focus: the per-check TIMEOUT. A hung Mongo/Redis ping must NOT stall the
 * probe — each check is raced against a 2s budget and a slow dependency is
 * reported `down` with detail `timeout`, yielding a fast `503`. We instantiate
 * the controller directly with typed mocks (the project's allowed style) and use
 * Jest fake timers to drive the race deterministically without waiting 2s of
 * wall-clock per test.
 */

/** A response double that records the status the controller sets. */
function makeRes(): Response & { statusCode: number } {
  const res: { statusCode: number; status(code: number): unknown } = {
    statusCode: 0,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number };
}

/** A connected Mongo connection whose `admin().ping` is the supplied impl. */
function makeMongo(pingImpl: () => Promise<unknown>): Connection {
  return {
    readyState: 1,
    db: { admin: () => ({ ping: pingImpl }) },
  } as unknown as Connection;
}

function makeRedis(pingImpl: () => Promise<string>): Redis {
  return { ping: pingImpl } as unknown as Redis;
}

describe('HealthController', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports 200/ok when both dependencies ping successfully', async () => {
    const controller = new HealthController(
      makeMongo(async () => ({ ok: 1 })),
      makeRedis(async () => 'PONG'),
    );
    const res = makeRes();

    const body = await controller.check(res);

    expect(res.statusCode).toBe(HttpStatus.OK);
    expect(body.status).toBe('ok');
    expect(body.dependencies.mongo).toEqual({ status: 'up' });
    expect(body.dependencies.redis).toEqual({ status: 'up' });
  });

  it('reports 503/degraded with detail "timeout" when Mongo HANGS past the budget', async () => {
    jest.useFakeTimers();
    // A ping that never resolves → must be cut off by the race, not awaited forever.
    const controller = new HealthController(
      makeMongo(() => new Promise(() => undefined)),
      makeRedis(async () => 'PONG'),
    );
    const res = makeRes();

    const pending = controller.check(res);
    // Advance past the 2s per-check timeout to fire the race's reject.
    await jest.advanceTimersByTimeAsync(2_000);
    const body = await pending;

    expect(res.statusCode).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(body.status).toBe('degraded');
    expect(body.dependencies.mongo).toEqual({ status: 'down', detail: 'timeout' });
    // Redis still healthy → only Mongo is flagged.
    expect(body.dependencies.redis).toEqual({ status: 'up' });
  });

  it('reports 503/degraded with detail "timeout" when Redis HANGS past the budget', async () => {
    jest.useFakeTimers();
    const controller = new HealthController(
      makeMongo(async () => ({ ok: 1 })),
      makeRedis(() => new Promise<string>(() => undefined)),
    );
    const res = makeRes();

    const pending = controller.check(res);
    await jest.advanceTimersByTimeAsync(2_000);
    const body = await pending;

    expect(res.statusCode).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(body.dependencies.redis).toEqual({ status: 'down', detail: 'timeout' });
  });

  it('reports the underlying error message when a ping rejects (not a timeout)', async () => {
    const controller = new HealthController(
      makeMongo(async () => {
        throw new Error('not primary');
      }),
      makeRedis(async () => 'PONG'),
    );
    const res = makeRes();

    const body = await controller.check(res);

    expect(res.statusCode).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(body.dependencies.mongo).toEqual({ status: 'down', detail: 'not primary' });
  });

  it('reports Mongo down when the connection is not in the connected state', async () => {
    const mongo = { readyState: 0, db: undefined } as unknown as Connection;
    const controller = new HealthController(mongo, makeRedis(async () => 'PONG'));
    const res = makeRes();

    const body = await controller.check(res);

    expect(body.dependencies.mongo).toEqual({ status: 'down', detail: 'not connected' });
  });
});
