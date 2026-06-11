import { Inject, Injectable, Logger, type OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  escapeMarkdownV2,
  makeTelegramSender,
  type TelegramSend,
} from './telegram-transport';

/**
 * Categories the alerting pipeline tracks. Each category has its OWN throttle
 * window, so a flood of nginx 5xx alerts does not silence a concurrent FATAL
 * from the app, and vice-versa. Keep the enum CLOSED — every new caller picks
 * one of these, not an arbitrary string, so the per-category state map cannot
 * grow unbounded (it's exactly `len(AlertCategory)` entries).
 */
export type AlertCategory = 'api-fatal' | 'api-error' | 'nginx-5xx';

/**
 * Single FATAL/error payload as captured at the source. Plain data so it can be
 * created in a pino hook with no Nest container available.
 */
export interface AlertPayload {
  category: AlertCategory;
  /** Short, human-readable title — first line of the rendered message. */
  title: string;
  /** Optional file:line marker, e.g. `wallet.service.ts:142`. */
  source?: string;
  /** Error message (or any structured body); will be MarkdownV2-escaped + truncated. */
  message: string;
  /** Optional request-id from the pino req-scoped logger context. */
  requestId?: string;
  /** Optional top URL paths involved (used by the nginx watchdog summary). */
  topPaths?: string[];
}

/**
 * Throttle window in ms — at most ONE Telegram message per category per window.
 * Spec: "throttle to 1 msg per 10s per category to avoid flooding".
 */
const THROTTLE_WINDOW_MS = 10_000;

/**
 * Per-category running state. `pendingCount` accumulates events the throttler
 * SUPPRESSED; the next message we send carries it as `(+N suppressed)` so the
 * operator sees the burst size without getting one ping per event.
 */
interface CategoryState {
  /** Wall-clock `Date.now()` of the last actually-sent message. 0 = never. */
  lastSentAt: number;
  /** Count of events in the current window that were collapsed into the next send. */
  pendingCount: number;
  /** The most-recent suppressed payload — sent as the "latest" sample on flush. */
  pendingPayload: AlertPayload | null;
  /** Timer handle of the scheduled flush, so we can cancel on shutdown. */
  flushTimer: NodeJS.Timeout | null;
}

/**
 * Injectable clock — abstracted so tests use `jest.useFakeTimers()` against a
 * deterministic time source rather than the real wall clock. Default is plain
 * `Date.now`.
 *
 * The Nest injection token is a Symbol so it cannot collide with another
 * provider in the global module graph.
 */
export const ALERTING_CLOCK = Symbol('ALERTING_CLOCK');
export interface Clock {
  now(): number;
}

/** Default wall-clock implementation; replaceable in tests. */
export const SYSTEM_CLOCK: Clock = { now: () => Date.now() };

/**
 * Optional injection token for the Telegram send function — tests bind a jest
 * mock here; production gets the `makeTelegramSender(...)` instance. Optional
 * because production reads the config + builds the sender at boot.
 */
export const TELEGRAM_SENDER = Symbol('TELEGRAM_SENDER');

/**
 * AlertingService — small, in-process queue with per-category throttling.
 *
 * Behaviour (spec):
 *  - The FIRST event in a category fires IMMEDIATELY (no waiting).
 *  - Subsequent events within {@link THROTTLE_WINDOW_MS} are COLLAPSED into a
 *    single follow-up message scheduled at `lastSentAt + window`. The follow-up
 *    carries the latest payload + `(+N suppressed)` count.
 *  - When `TELEGRAM_BOT_TOKEN` / `TELEGRAM_ALERT_CHAT_ID` is missing the service
 *    NO-OPs (logs one warning at boot, never crashes the app, never throws).
 *
 * The clock is injectable ({@link ALERTING_CLOCK}) so the spec's "use injectable
 * clock for testability (NOT a literal time constructor)" is honoured — tests
 * advance a fake clock + jest fake timers, never `setTimeout` with real delays.
 */
@Injectable()
export class AlertingService implements OnModuleInit {
  private readonly logger = new Logger(AlertingService.name);

  /** Per-category state. Closed enum → fixed-size, no leak. */
  private readonly state = new Map<AlertCategory, CategoryState>();

  /** Bound Telegram send fn (or no-op when disabled). */
  private send: TelegramSend;

  /** Whether the transport is actually wired (vs. the no-op fallback). */
  private enabled = false;

  /** Injected clock — uses `Date.now` in prod, a fake source in tests. */
  private readonly clock: Clock;

  constructor(
    private readonly configService: ConfigService,
    @Optional() @Inject(ALERTING_CLOCK) clock?: Clock,
    @Optional() @Inject(TELEGRAM_SENDER) injectedSender?: TelegramSend,
  ) {
    this.clock = clock ?? SYSTEM_CLOCK;
    // If a test bound an explicit sender, use it (and treat as enabled). Else we
    // build from config at onModuleInit() so a missing token logs a single warn.
    if (injectedSender) {
      this.send = injectedSender;
      this.enabled = true;
    } else {
      // Placeholder until onModuleInit replaces it.
      this.send = async () => false;
    }
  }

  onModuleInit(): void {
    if (this.enabled) return; // Already wired via DI (tests).
    // Accept BOTH naming conventions for the bot token: this module's spec uses
    // `TELEGRAM_BOT_TOKEN`, the older cert-watch sidecar in docker-compose.prod
    // already uses `TELEGRAM_ALERT_BOT_TOKEN`. Reading either keeps the operator
    // from having to set the same secret under two names.
    const botToken = (
      this.configService.get<string>('TELEGRAM_BOT_TOKEN') ??
      this.configService.get<string>('TELEGRAM_ALERT_BOT_TOKEN') ??
      ''
    ).trim();
    const chatId = (this.configService.get<string>('TELEGRAM_ALERT_CHAT_ID') ?? '').trim();
    if (!botToken || !chatId) {
      this.logger.warn(
        'Telegram alerting DISABLED: TELEGRAM_BOT_TOKEN / TELEGRAM_ALERT_CHAT_ID not set. ' +
          'Set both to forward FATAL logs and 5xx bursts to the operator chat.',
      );
      this.enabled = false;
      return;
    }
    this.send = makeTelegramSender({ botToken, chatId });
    this.enabled = true;
    this.logger.log('Telegram alerting enabled.');
  }

  /**
   * Public entry point. Called by:
   *  - the pino error/fatal hook on `error`/`fatal` logs,
   *  - `AllExceptionsFilter` on any 5xx HTTP response.
   *
   * NEVER throws — alerting failures must not bubble back into the request
   * lifecycle. Returns a promise so tests can `await` the resolved state, but
   * production callers fire-and-forget (the LoggerModule's hook never `await`s).
   */
  async notify(payload: AlertPayload): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.enqueue(payload);
    } catch (err) {
      // Last-resort guard — the throttle/send path already swallows transport
      // errors, but a typo in render() shouldn't crash the request that logged.
      this.logger.warn(`AlertingService.notify failed: ${(err as Error).message}`);
    }
  }

  /**
   * Cancel any pending flush timers — Nest calls this during shutdown if we
   * implement OnApplicationShutdown, but it's safe to call manually in tests.
   */
  shutdown(): void {
    for (const s of this.state.values()) {
      if (s.flushTimer) {
        clearTimeout(s.flushTimer);
        s.flushTimer = null;
      }
    }
  }

  /** Internal: route a payload through the throttler. */
  private async enqueue(payload: AlertPayload): Promise<void> {
    const now = this.clock.now();
    const s = this.getState(payload.category);
    const elapsed = now - s.lastSentAt;

    if (s.lastSentAt === 0 || elapsed >= THROTTLE_WINDOW_MS) {
      // Window is open: send immediately.
      s.lastSentAt = now;
      // Drain any pending count INTO this send so the operator never sees a
      // "lost" suppression — the message shows `(+N suppressed)`.
      const drained = s.pendingCount;
      s.pendingCount = 0;
      s.pendingPayload = null;
      await this.send(renderMessage(payload, drained));
      return;
    }

    // Window is closed: collapse this event into the next flush.
    s.pendingCount += 1;
    s.pendingPayload = payload; // Remember the latest sample.

    if (!s.flushTimer) {
      const delay = Math.max(0, THROTTLE_WINDOW_MS - elapsed);
      s.flushTimer = setTimeout(() => {
        // Re-read inside the timer: the state may have been mutated meanwhile.
        const flush = this.getState(payload.category);
        flush.flushTimer = null;
        const sample = flush.pendingPayload;
        const count = flush.pendingCount;
        if (!sample || count === 0) return;
        flush.pendingPayload = null;
        flush.pendingCount = 0;
        flush.lastSentAt = this.clock.now();
        // Fire-and-forget; renderMessage handles the (+N) summary.
        void this.send(renderMessage(sample, count));
      }, delay);
      // Allow the process to exit even if a timer is pending (graceful shutdown).
      if (typeof s.flushTimer.unref === 'function') s.flushTimer.unref();
    }
  }

  /** Lazily initialise + return a category's state slot. */
  private getState(category: AlertCategory): CategoryState {
    let s = this.state.get(category);
    if (!s) {
      s = { lastSentAt: 0, pendingCount: 0, pendingPayload: null, flushTimer: null };
      this.state.set(category, s);
    }
    return s;
  }
}

/**
 * Render a payload + optional suppression count into a MarkdownV2 Telegram
 * message. Kept as a pure function so the spec can be exercised without DI.
 *
 * Headline emoji is chosen per category:
 *   - `api-fatal`  → 🔴 (matches spec exemplar)
 *   - `api-error`  → ⚠️
 *   - `nginx-5xx`  → 🚨 (matches spec exemplar)
 */
export function renderMessage(payload: AlertPayload, suppressedCount: number): string {
  const headline = (() => {
    switch (payload.category) {
      case 'api-fatal':
        return `*🔴 FATAL — ruletka\\.top api*`;
      case 'api-error':
        return `*⚠️ ERROR — ruletka\\.top api*`;
      case 'nginx-5xx':
        return `*🚨 nginx 5xx burst*`;
    }
  })();

  const lines: string[] = [headline];

  // Title: a short, plain-text label (already escaped at source if user-supplied).
  if (payload.title) {
    lines.push(escapeMarkdownV2(payload.title));
  }

  if (payload.source) {
    lines.push(`\`${escapeMarkdownV2(payload.source)}\``);
  }

  if (payload.message) {
    // Code-block format for stack/message bodies → readable in Telegram.
    lines.push('```');
    // Inside ``` … ``` MarkdownV2 still wants the closing backticks escaped,
    // but plain content is shown verbatim. Strip backticks defensively so we
    // never produce an unterminated fence.
    lines.push(payload.message.replace(/`/g, "'"));
    lines.push('```');
  }

  if (payload.requestId) {
    lines.push(`req\\_id: \`${escapeMarkdownV2(payload.requestId)}\``);
  }

  if (payload.topPaths && payload.topPaths.length > 0) {
    lines.push('*top paths:*');
    for (const p of payload.topPaths.slice(0, 3)) {
      lines.push(`• \`${escapeMarkdownV2(p)}\``);
    }
  }

  if (suppressedCount > 0) {
    lines.push(`_\\(\\+${suppressedCount} suppressed in window\\)_`);
  }

  return lines.join('\n');
}
