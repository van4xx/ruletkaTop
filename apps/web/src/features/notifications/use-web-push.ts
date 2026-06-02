'use client';

/**
 * Web Push subscription lifecycle for the browser.
 *
 * Keyless-by-default (per the integrator brief): the whole feature is gated on
 * `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. When that env var is unset — e.g. local dev
 * without push secrets — {@link useWebPush} reports `supported: false` and the
 * settings toggle hides itself; nothing here ever touches the network. So the
 * app runs with zero push configuration.
 *
 * When a VAPID key IS present and the browser supports the Push API, the hook:
 *   1. registers the service worker (`/sw.js`, scope `/`),
 *   2. reflects the current Notification permission + subscription state,
 *   3. `enable()` → request permission, `PushManager.subscribe(...)` with the
 *      VAPID `applicationServerKey`, then POST the W3C subscription to
 *      `/notifications/push/subscribe`,
 *   4. `disable()` → unsubscribe locally and tell the API to drop the endpoint.
 *
 * The W3C Push API shapes (PushManager.subscribe, applicationServerKey as a
 * Uint8Array from a base64url VAPID public key) follow the MDN spec.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PushSubscriptionDto } from '@ruletka/shared-types';
import { notificationsApi } from './api';

/** The app's VAPID public key (base64url). Unset → push disabled entirely. */
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
/** Path of the service worker that owns the push + click handlers. */
const SW_URL = '/sw.js';

export type PushPermission = 'default' | 'granted' | 'denied';

export interface UseWebPushResult {
  /** Push is configured (VAPID key present) AND the browser supports it. */
  supported: boolean;
  /** Whether an active push subscription exists for this browser. */
  subscribed: boolean;
  /** Current Notification permission (`default` until known / unsupported). */
  permission: PushPermission;
  /** A subscribe/unsubscribe round-trip is in flight. */
  busy: boolean;
  /** Last error message from enable/disable, if any. */
  error: string | null;
  /** Request permission (if needed), subscribe, and register with the API. */
  enable: () => Promise<void>;
  /** Unsubscribe locally and drop the subscription server-side. */
  disable: () => Promise<void>;
}

/** Convert a base64url VAPID key into the Uint8Array `subscribe` expects. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** True when this browser exposes the APIs Web Push needs. */
function browserSupportsPush(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Map a live PushSubscription into the contract DTO (W3C shape). */
function toDto(sub: PushSubscription): PushSubscriptionDto {
  const json = sub.toJSON();
  return {
    endpoint: sub.endpoint,
    expirationTime: sub.expirationTime ?? null,
    keys: {
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
    },
  };
}

export function useWebPush(): UseWebPushResult {
  // `supported` requires BOTH a configured VAPID key and browser capability.
  const configured = Boolean(VAPID_PUBLIC_KEY);
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [permission, setPermission] = useState<PushPermission>('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  // Detect support + reflect any existing subscription on mount.
  useEffect(() => {
    if (!configured || !browserSupportsPush()) {
      setSupported(false);
      return;
    }
    let cancelled = false;
    setSupported(true);
    setPermission(Notification.permission as PushPermission);

    (async () => {
      try {
        const reg = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
        if (cancelled) return;
        registrationRef.current = reg;
        const existing = await reg.pushManager.getSubscription();
        if (!cancelled) setSubscribed(Boolean(existing));
      } catch {
        // SW registration failed (e.g. insecure context) — treat as unsupported.
        if (!cancelled) setSupported(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [configured]);

  const getRegistration = useCallback(async (): Promise<ServiceWorkerRegistration> => {
    if (registrationRef.current) return registrationRef.current;
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
    registrationRef.current = reg;
    return reg;
  }, []);

  const enable = useCallback(async () => {
    if (!supported || !VAPID_PUBLIC_KEY) return;
    setBusy(true);
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm as PushPermission);
      if (perm !== 'granted') {
        setError(perm === 'denied' ? 'Уведомления заблокированы в браузере.' : null);
        return;
      }
      const reg = await getRegistration();
      // Reuse an existing subscription if the browser already has one.
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
        }));
      await notificationsApi.subscribePush(toDto(sub));
      setSubscribed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось включить push-уведомления.');
    } finally {
      setBusy(false);
    }
  }, [supported, getRegistration]);

  const disable = useCallback(async () => {
    if (!supported) return;
    setBusy(true);
    setError(null);
    try {
      const reg = await getRegistration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const { endpoint } = sub;
        await sub.unsubscribe();
        // Best-effort server cleanup; local state is already off.
        try {
          await notificationsApi.unsubscribePush(endpoint);
        } catch {
          /* ignore — the subscription is gone locally regardless */
        }
      }
      setSubscribed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отключить push-уведомления.');
    } finally {
      setBusy(false);
    }
  }, [supported, getRegistration]);

  return { supported, subscribed, permission, busy, error, enable, disable };
}

/**
 * Silently re-register an EXISTING browser push subscription with the API.
 *
 * Mounted globally for authenticated users (see providers): if the browser
 * already holds a push subscription (the user enabled it before), re-POST it so
 * the server keeps a current record after a token rotation / backend restart.
 * Never prompts and never subscribes — a no-op when push isn't configured, the
 * browser can't do push, or no subscription exists yet. Renders nothing.
 */
export function useWebPushResync(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !VAPID_PUBLIC_KEY || !browserSupportsPush()) return;
    if (Notification.permission !== 'granted') return;
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
        const sub = await reg.pushManager.getSubscription();
        if (!sub || cancelled) return;
        await notificationsApi.subscribePush(toDto(sub));
      } catch {
        /* best-effort — the settings toggle remains the source of truth */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);
}
