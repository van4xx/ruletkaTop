/**
 * Module-level singleton bridge to the AlertingService.
 *
 * Two callers need to push events into the alerting pipeline BEFORE / OUTSIDE
 * the Nest DI container:
 *  - the pino `customLogLevel` / `hooks.logMethod` hook in `app.module.ts`,
 *    which runs from inside the LoggerModule factory and cannot inject a peer
 *    provider (would loop), AND
 *  - the `AllExceptionsFilter` which is instantiated with `new …()` in main.ts
 *    via `app.useGlobalFilters(...)` and therefore has no constructor DI either.
 *
 * Rather than introduce a circular dependency or pass the service through every
 * call site, we publish it on this module-level reference at boot
 * (AlertingModule constructor) and read it at log time. Reads are guarded so
 * an event logged BEFORE the alerting module is wired (or AFTER shutdown, when
 * the bridge is nulled) is silently dropped — fail-safe, not crash-on-startup.
 */
import type { AlertPayload } from './alerting.service';

/** Narrow interface so the bridge does not pull the whole service surface. */
export interface AlertingBridge {
  notify(payload: AlertPayload): Promise<void>;
}

let bridge: AlertingBridge | null = null;

/** Set by AlertingModule on boot; cleared on shutdown. */
export function setAlertingBridge(target: AlertingBridge | null): void {
  bridge = target;
}

/**
 * Push a payload through the bridge if one is wired. SAFE to call before boot
 * (no-op) and from any context (sync caller / pino hook / express filter).
 *
 * NEVER throws — alerting must not break the request that triggered it. The
 * promise from `notify` is intentionally NOT awaited so the caller is not
 * coupled to Telegram's RTT.
 */
export function reportAlert(payload: AlertPayload): void {
  if (!bridge) return;
  try {
    // Fire-and-forget — the service catches its own errors.
    void bridge.notify(payload);
  } catch {
    // Defence-in-depth: if `notify` is somehow synchronous-throwing,
    // swallow it so the caller's lifecycle is preserved.
  }
}
