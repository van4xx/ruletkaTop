import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { AppNotification } from '@ruletka/shared-types';

import type {
  PushSendResult,
  WebPushProvider,
  WebPushTarget,
} from './push.types';

/**
 * `web-push` is OPTIONAL: it is only required (lazily, at construction of the
 * enabled provider) when VAPID keys are present, so the API runs — and these
 * specs run — without the dependency installed. Typed minimally to what we use.
 */
interface WebPushModule {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: {
      endpoint: string;
      expirationTime?: number | null;
      keys: { p256dh: string; auth: string };
    },
    payload?: string,
  ): Promise<unknown>;
}

/** HTTP status codes from a push service meaning "this subscription is dead". */
const GONE_STATUS_CODES = new Set([404, 410]);

/**
 * No-op Web Push provider used when VAPID keys are NOT configured. Keeps the
 * notifications flow fully working in dev/CI without secrets: a notification is
 * still persisted + delivered in-app over the socket; only the browser push
 * fan-out is skipped.
 */
export class NoopWebPushProvider implements WebPushProvider {
  readonly enabled = false;

  async send(): Promise<PushSendResult> {
    return { ok: false, gone: false };
  }
}

/**
 * Real Web Push provider backed by the `web-push` library + VAPID keys.
 *
 * Construct only when all VAPID env vars are present (see
 * {@link resolveWebPushProvider}). Encrypts the {@link AppNotification} as the
 * payload and POSTs it to the subscription endpoint. A `404`/`410` response
 * marks the target `gone` so the {@link PushService} prunes the dead row.
 */
export class WebPushLibProvider implements WebPushProvider {
  readonly enabled = true;
  private readonly logger = new Logger(WebPushLibProvider.name);

  constructor(private readonly webpush: WebPushModule) {}

  async send(
    target: WebPushTarget,
    notification: AppNotification,
  ): Promise<PushSendResult> {
    try {
      await this.webpush.sendNotification(
        {
          endpoint: target.endpoint,
          expirationTime: target.expirationTime,
          keys: target.keys,
        },
        JSON.stringify(notification),
      );
      return { ok: true, gone: false };
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      const gone = typeof statusCode === 'number' && GONE_STATUS_CODES.has(statusCode);
      if (!gone) {
        this.logger.warn(
          `web push to ${target.endpoint} failed (status=${statusCode ?? '?'}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      return { ok: false, gone };
    }
  }
}

/**
 * Build the Web Push provider for the DI container. Returns the real
 * `web-push`-backed provider when `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` are
 * set (and `web-push` is installed), otherwise a no-op. NEVER throws: a missing
 * dependency or bad key only degrades to the no-op so boot can't fail on it.
 *
 * `VAPID_SUBJECT` defaults to a `mailto:` so a minimal config (just the two
 * keys) works; the subject only needs to be a valid `mailto:`/`https:` URI.
 */
export function resolveWebPushProvider(config: ConfigService): WebPushProvider {
  const logger = new Logger('WebPushProvider');
  const publicKey = config.get<string>('VAPID_PUBLIC_KEY');
  const privateKey = config.get<string>('VAPID_PRIVATE_KEY');
  if (!publicKey || !privateKey) {
    logger.log('VAPID keys not set — Web Push disabled (in-app + socket only).');
    return new NoopWebPushProvider();
  }
  const subject = config.get<string>('VAPID_SUBJECT', 'mailto:admin@ruletka.top');
  try {
    // Lazy require so the package is only needed when actually enabled. The
    // ESLint/TS rule for require is relaxed here intentionally (optional dep).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const webpush = require('web-push') as WebPushModule;
    webpush.setVapidDetails(subject, publicKey, privateKey);
    logger.log('Web Push enabled (VAPID configured).');
    return new WebPushLibProvider(webpush);
  } catch (err) {
    logger.warn(
      `VAPID keys set but 'web-push' unavailable — Web Push disabled: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return new NoopWebPushProvider();
  }
}
