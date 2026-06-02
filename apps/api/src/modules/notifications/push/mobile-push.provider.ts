import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { PushSendResult, MobilePushProvider } from './push.types';

/**
 * No-op mobile push provider used when no Firebase / APNs credentials are
 * configured (the default). The notification is still persisted + delivered
 * in-app over the socket; only the native (FCM/APNs) fan-out is skipped — so the
 * app runs without cloud-messaging secrets in dev/CI.
 *
 * A real deployment replaces this behind the same {@link MobilePushProvider}
 * interface with a Firebase Admin SDK call (`messaging().send({ token, … })`)
 * mapping a `404`/`UNREGISTERED` response to `{ gone: true }` so the
 * {@link PushService} prunes stale device tokens — identical contract to the
 * Web Push side.
 */
export class NoopMobilePushProvider implements MobilePushProvider {
  readonly enabled = false;

  async send(): Promise<PushSendResult> {
    return { ok: false, gone: false };
  }
}

/**
 * Build the mobile push provider for the DI container. Currently always the
 * keyless no-op; presence of `FIREBASE_SERVICE_ACCOUNT` (or equivalent) is where
 * a real Firebase Admin provider would be constructed. NEVER throws.
 */
export function resolveMobilePushProvider(config: ConfigService): MobilePushProvider {
  const logger = new Logger('MobilePushProvider');
  const serviceAccount = config.get<string>('FIREBASE_SERVICE_ACCOUNT');
  if (!serviceAccount) {
    logger.log('Firebase creds not set — mobile push disabled (in-app + socket only).');
    return new NoopMobilePushProvider();
  }
  // Firebase Admin is not wired in this phase; degrade to no-op rather than
  // pretend to send. Swap in a real provider here when creds + SDK are added.
  logger.warn('FIREBASE_SERVICE_ACCOUNT set but mobile push provider not wired — using no-op.');
  return new NoopMobilePushProvider();
}
