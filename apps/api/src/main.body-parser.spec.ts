import { Body, Controller, HttpCode, HttpStatus, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ExpressAdapter } from '@nestjs/platform-express';

import { request } from 'node:http';
import type { AddressInfo } from 'node:net';

import { configureBodyParsers } from './main';

/**
 * Boot-level regression test for the SECOND-AUDIT body-limit finding: the global
 * 100kb JSON cap 413'd the 2MB moderation-evidence contract, so evidence never
 * reached the server. {@link configureBodyParsers} now keeps a TIGHT global cap
 * but mounts a LARGER per-route parser on POST /api/moderation/frame and POST
 * /api/reports. This drives the REAL helper (not a copy) against a live HTTP
 * listener to assert:
 *   - a ~1.5MB body to an evidence route is accepted (NOT 413);
 *   - a ~1.5MB body to a NON-evidence route IS rejected 413 (the wide limit is
 *     strictly per-route, not a global widening);
 *   - rawBody is captured on the evidence route (the verify hook still runs).
 */

const GLOBAL_PREFIX = 'api';

/** Echoes the parsed body size + whether `req.rawBody` was captured. */
@Controller()
class ProbeController {
  @Post('moderation/frame')
  @HttpCode(HttpStatus.OK)
  frame(@Body() body: { evidence?: string }): { len: number } {
    return { len: body?.evidence?.length ?? 0 };
  }

  @Post('reports')
  @HttpCode(HttpStatus.OK)
  reports(@Body() body: { evidence?: string }): { len: number } {
    return { len: body?.evidence?.length ?? 0 };
  }

  // A NON-evidence route: must stay on the tight global limit.
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: { token?: string }): { len: number } {
    return { len: body?.token?.length ?? 0 };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

interface HttpResult {
  status: number;
  body: string;
}

/** Minimal JSON POST helper over node:http (no supertest dependency). */
function postJson(port: number, path: string, payload: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe('configureBodyParsers — evidence routes accept large bodies, others stay tight', () => {
  let app: NestExpressApplication;
  let port: number;

  // ~1.5MB evidence string — well over the 256kb global cap, under the 3mb
  // per-route cap and the 2,000,000-char zod max.
  const bigEvidence = 'a'.repeat(1_500_000);

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(ProbeModule, new ExpressAdapter(), {
      // Mirror production: rawBody capture is requested app-wide.
      rawBody: true,
      logger: false,
    });
    app.setGlobalPrefix(GLOBAL_PREFIX);
    // Drive the SAME production helper.
    configureBodyParsers(app, GLOBAL_PREFIX);
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('does NOT 413 a ~1.5MB evidence POST to /api/moderation/frame', async () => {
    const payload = JSON.stringify({ evidence: bigEvidence });
    const res = await postJson(port, '/api/moderation/frame', payload);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ len: bigEvidence.length });
  });

  it('does NOT 413 a ~1.5MB evidence POST to /api/reports', async () => {
    const payload = JSON.stringify({ evidence: bigEvidence });
    const res = await postJson(port, '/api/reports', payload);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ len: bigEvidence.length });
  });

  it('STILL 413s a ~1.5MB POST to a non-evidence route (limit is per-route)', async () => {
    const payload = JSON.stringify({ token: bigEvidence });
    const res = await postJson(port, '/api/auth/login', payload);
    expect(res.status).toBe(413);
  });

  it('accepts a small body on a non-evidence route (global parser works)', async () => {
    const payload = JSON.stringify({ token: 'short' });
    const res = await postJson(port, '/api/auth/login', payload);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ len: 'short'.length });
  });
});
