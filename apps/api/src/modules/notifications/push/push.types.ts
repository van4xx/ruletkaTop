import type { AppNotification } from '@ruletka/shared-types';

/**
 * DI token for the Web Push (browser) provider. Bound to a keyless no-op when
 * VAPID env vars are unset, or the real `web-push`-backed provider otherwise.
 */
export const WEB_PUSH_PROVIDER = 'WEB_PUSH_PROVIDER';

/**
 * DI token for the mobile push (FCM / APNs) provider. Bound to a keyless no-op
 * when no Firebase/APNs creds are configured.
 */
export const MOBILE_PUSH_PROVIDER = 'MOBILE_PUSH_PROVIDER';

/** A stored browser subscription, as the providers consume it. */
export interface WebPushTarget {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}

/** Outcome of a single delivery attempt to one push target. */
export interface PushSendResult {
  /** Whether the message was accepted by the push service. */
  ok: boolean;
  /**
   * When `true`, the target is permanently invalid (e.g. the push service
   * returned 404/410) and the caller should DELETE the stored subscription.
   */
  gone: boolean;
}

/**
 * Browser Web Push provider. The real implementation encrypts + POSTs the
 * payload via the `web-push` library + VAPID keys; the keyless default is a
 * no-op so the app runs without secrets in dev.
 */
export interface WebPushProvider {
  /** Whether the provider is configured to actually send (VAPID present). */
  readonly enabled: boolean;
  /** Deliver one notification to one browser subscription (best-effort). */
  send(target: WebPushTarget, notification: AppNotification): Promise<PushSendResult>;
}

/**
 * Mobile push provider (FCM / APNs). The keyless default is a no-op; a real
 * deployment wires Firebase Admin / an APNs client behind this same interface.
 */
export interface MobilePushProvider {
  /** Whether the provider is configured to actually send. */
  readonly enabled: boolean;
  /** Deliver one notification to one device token (best-effort). */
  send(token: string, notification: AppNotification): Promise<PushSendResult>;
}
