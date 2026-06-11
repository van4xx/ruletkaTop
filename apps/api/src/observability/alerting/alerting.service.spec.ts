import type { ConfigService } from '@nestjs/config';

import {
  ALERTING_CLOCK,
  AlertingService,
  type AlertPayload,
  type Clock,
  renderMessage,
  TELEGRAM_SENDER,
} from './alerting.service';
import { escapeMarkdownV2, truncateForTelegram } from './telegram-transport';

/**
 * AlertingService unit tests.
 *
 * Deterministic by design:
 *  - An INJECTED `Clock` is advanced manually — never `Date.now()`.
 *  - jest fake timers drive the throttle-window flush — never real `setTimeout`.
 *  - The Telegram sender is a jest.Mock — no fetch, no network.
 *
 * Spec ground rules exercised here:
 *  - FIRST event per category fires IMMEDIATELY.
 *  - Bursts inside a 10s window COLLAPSE into one summarised follow-up.
 *  - Each category has an INDEPENDENT throttle window.
 *  - Missing TELEGRAM_BOT_TOKEN → service NO-OPs, never throws.
 *  - Renderer escapes MarkdownV2 metacharacters AND truncates >4096 chars.
 */

const THROTTLE_WINDOW_MS = 10_000;

/** Build a ConfigService stub returning the given env map. */
function makeConfig(env: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => env[key]),
  } as unknown as ConfigService;
}

/** Build a controllable clock the test can advance synchronously. */
function makeClock(initial = 1_000_000): Clock & { advance(ms: number): void; set(v: number): void } {
  let t = initial;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
    set(v: number) {
      t = v;
    },
  };
}

describe('AlertingService — throttle + category isolation', () => {
  let send: jest.Mock<Promise<boolean>, [string]>;
  let clock: ReturnType<typeof makeClock>;
  let service: AlertingService;

  beforeEach(() => {
    jest.useFakeTimers();
    send = jest.fn().mockResolvedValue(true);
    clock = makeClock();
    service = new AlertingService(
      makeConfig({ TELEGRAM_BOT_TOKEN: 'tkn', TELEGRAM_ALERT_CHAT_ID: '42' }),
      clock,
      // Cast through unknown so the injected sender slot accepts the jest.Mock.
      send as unknown as Parameters<typeof Reflect.construct>[1][2],
    );
    // Because we passed an injectedSender, onModuleInit is a no-op (already enabled).
    service.onModuleInit();
  });

  afterEach(() => {
    service.shutdown();
    jest.useRealTimers();
  });

  function notify(category: AlertPayload['category'], title = 'boom'): Promise<void> {
    return service.notify({ category, title, message: 'stack…' });
  }

  it('sends the FIRST event of a category immediately, no waiting', async () => {
    await notify('api-fatal');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toContain('FATAL');
  });

  it('SUPPRESSES events within the 10s window and emits ONE summary on flush', async () => {
    await notify('api-fatal', 'first');
    expect(send).toHaveBeenCalledTimes(1);

    // Burst: 4 more events, only 2s apart — all should be collapsed.
    clock.advance(2_000);
    await notify('api-fatal', 'second');
    clock.advance(2_000);
    await notify('api-fatal', 'third');
    clock.advance(1_000);
    await notify('api-fatal', 'fourth');
    clock.advance(1_000);
    await notify('api-fatal', 'fifth');
    // Still only the first message has actually been sent.
    expect(send).toHaveBeenCalledTimes(1);

    // Advance the wall clock for the flush; the scheduled timer was set when
    // the second event came in (at t=+2s) for a delay of 10s - 2s = 8s.
    clock.advance(8_000);
    jest.advanceTimersByTime(8_000);
    // Let the promise the flush timer kicked off settle.
    await Promise.resolve();

    expect(send).toHaveBeenCalledTimes(2);
    const followup = send.mock.calls[1]![0];
    // The follow-up shows the LATEST title + suppressed count (4 collapsed).
    expect(followup).toContain('fifth');
    expect(followup).toContain('\\(\\+4 suppressed in window\\)');
  });

  it('opens a fresh window AFTER it elapses (next event fires immediately)', async () => {
    await notify('api-fatal');
    expect(send).toHaveBeenCalledTimes(1);
    // Skip past the window with no events in it.
    clock.advance(THROTTLE_WINDOW_MS + 1);
    await notify('api-fatal', 'fresh');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0]).toContain('fresh');
  });

  it('keeps per-category throttles INDEPENDENT (nginx burst does not silence api-fatal)', async () => {
    await notify('nginx-5xx');
    await notify('api-fatal');
    // Both first events of their respective categories fire immediately.
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('NO-OPs cleanly when TELEGRAM_BOT_TOKEN is missing (graceful degradation)', async () => {
    const disabled = new AlertingService(
      makeConfig({ TELEGRAM_BOT_TOKEN: '', TELEGRAM_ALERT_CHAT_ID: '42' }),
      clock,
    );
    // Service falls back to the placeholder no-op send; calling notify never throws.
    disabled.onModuleInit();
    await expect(
      disabled.notify({ category: 'api-fatal', title: 't', message: 'm' }),
    ).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('shutdown() cancels any pending flush timers', async () => {
    await notify('api-fatal'); // fires immediately
    clock.advance(1_000);
    await notify('api-fatal'); // scheduled flush at +9s
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    service.shutdown();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('renderMessage()', () => {
  it('renders the 🔴 FATAL headline for api-fatal', () => {
    const out = renderMessage({ category: 'api-fatal', title: 't', message: 'm' }, 0);
    expect(out.startsWith('*🔴 FATAL — ruletka\\.top api*')).toBe(true);
  });

  it('renders the 🚨 nginx headline with top paths for nginx-5xx', () => {
    const out = renderMessage(
      {
        category: 'nginx-5xx',
        title: '20 events in last 60s',
        message: '',
        topPaths: ['/api/wallet', '/api/auth/login', '/api/feed'],
      },
      0,
    );
    expect(out).toContain('*🚨 nginx 5xx burst*');
    expect(out).toContain('*top paths:*');
    expect(out).toContain('/api/wallet');
    expect(out).toContain('/api/auth/login');
    expect(out).toContain('/api/feed');
  });

  it('appends a (+N suppressed) line when called with a positive count', () => {
    const out = renderMessage({ category: 'api-error', title: 't', message: 'm' }, 7);
    expect(out).toContain('\\(\\+7 suppressed in window\\)');
  });
});

describe('telegram-transport helpers', () => {
  it('escapeMarkdownV2 escapes every reserved character', () => {
    const input = '_*[]()~`>#+-=|{}.!\\';
    const out = escapeMarkdownV2(input);
    // Every input char produces a `\<ch>` pair, so length doubles.
    expect(out.length).toBe(input.length * 2);
    for (const ch of input) {
      expect(out).toContain(`\\${ch}`);
    }
  });

  it('truncateForTelegram leaves short text untouched', () => {
    const short = 'short';
    expect(truncateForTelegram(short)).toBe(short);
  });

  it('truncateForTelegram caps at 4096 chars with a marker', () => {
    const huge = 'x'.repeat(5_000);
    const out = truncateForTelegram(huge);
    expect(out.length).toBe(4096);
    expect(out.endsWith('…[truncated]')).toBe(true);
  });
});
