import { HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
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

/**
 * A ConfigService double whose `get('NODE_ENV')` returns the supplied env.
 * Defaults to a non-production env so the existing checks keep seeing the full
 * (debuggable) failure detail; the redaction test flips it to `production`.
 */
function makeConfig(nodeEnv = 'test'): ConfigService {
  return { get: (key: string) => (key === 'NODE_ENV' ? nodeEnv : undefined) } as unknown as ConfigService;
}

describe('HealthController', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports 200/ok when both dependencies ping successfully', async () => {
    const controller = new HealthController(
      makeMongo(async () => ({ ok: 1 })),
      makeRedis(async () => 'PONG'),
      makeConfig(),
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
      makeConfig(),
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
      makeConfig(),
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
      makeConfig(),
    );
    const res = makeRes();

    const body = await controller.check(res);

    expect(res.statusCode).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(body.dependencies.mongo).toEqual({ status: 'down', detail: 'not primary' });
  });

  it('REDACTS the raw driver error to a generic "unreachable" in production (no infra leak)', async () => {
    // `/health` is unauthenticated; a verbatim driver message could leak Mongo/
    // Redis topology, hostnames, and IPs. In production every non-timeout
    // failure must collapse to a generic string.
    const controller = new HealthController(
      makeMongo(async () => {
        throw new Error('failed to connect to server [mongo-primary.internal:27017]');
      }),
      makeRedis(async () => {
        throw new Error('Redis connection to 10.0.3.7:6379 failed - ECONNREFUSED');
      }),
      makeConfig('production'),
    );
    const res = makeRes();

    const body = await controller.check(res);

    expect(res.statusCode).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    // Neither the verbatim message, host, nor IP must appear — only 'unreachable'.
    expect(body.dependencies.mongo).toEqual({ status: 'down', detail: 'unreachable' });
    expect(body.dependencies.redis).toEqual({ status: 'down', detail: 'unreachable' });
  });

  it('still surfaces the "timeout" sentinel (not infra-revealing) even in production', async () => {
    jest.useFakeTimers();
    const controller = new HealthController(
      makeMongo(() => new Promise(() => undefined)),
      makeRedis(async () => 'PONG'),
      makeConfig('production'),
    );
    const res = makeRes();

    const pending = controller.check(res);
    await jest.advanceTimersByTimeAsync(2_000);
    const body = await pending;

    // The redaction keeps the timeout branch intact (it carries no host/IP).
    expect(body.dependencies.mongo).toEqual({ status: 'down', detail: 'timeout' });
  });

  it('reports Mongo down when the connection is not in the connected state', async () => {
    const mongo = { readyState: 0, db: undefined } as unknown as Connection;
    const controller = new HealthController(mongo, makeRedis(async () => 'PONG'), makeConfig());
    const res = makeRes();

    const body = await controller.check(res);

    expect(body.dependencies.mongo).toEqual({ status: 'down', detail: 'not connected' });
  });
});
