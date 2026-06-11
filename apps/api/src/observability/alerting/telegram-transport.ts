/**
 * Telegram Bot API transport — a tiny, dependency-free adapter that POSTs a
 * `sendMessage` call to `https://api.telegram.org/bot<TOKEN>/sendMessage`.
 *
 * Intentionally OWNS no policy:
 *   - No throttling, no batching, no retry — those live in {@link AlertingService},
 *     where they are exercised against an injected `Clock` for deterministic tests.
 *   - No global state — every call carries the bot token + chat id + body.
 *
 * The transport is FAIL-OPEN: a network/HTTP error is caught, logged once and
 * swallowed. An alerting pipeline that crashes the API on a Telegram outage
 * would defeat the point of having alerting at all.
 *
 * Telegram's `sendMessage` accepts up to 4096 characters of text in MarkdownV2
 * mode. The transport truncates safely at that boundary (with a `…[truncated]`
 * marker) so a wall-of-stack-trace never produces a 400 from Telegram.
 *
 * MarkdownV2 escaping NOTE: Telegram's MarkdownV2 reserves these characters and
 * REQUIRES they be escaped with a leading backslash when they appear in literal
 * text: `_ * [ ] ( ) ~ \` > # + - = | { } . !`. {@link escapeMarkdownV2}
 * escapes all of them in a single pass. Callers that want a *literal* asterisk
 * around bold text should escape ONLY the dynamic body and concatenate the
 * `*…*` wrapper separately.
 */
import { Logger } from '@nestjs/common';

const TELEGRAM_BASE_URL = 'https://api.telegram.org';

/** Telegram caps `text` at 4096 characters; cut early to leave room for the marker. */
const TELEGRAM_MAX_TEXT = 4096;
const TRUNCATION_MARKER = '…[truncated]';

/** Default per-request timeout in ms — Telegram should respond inside a second. */
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * MarkdownV2 metacharacters that must be backslash-escaped when present as
 * literal text. The regex is anchored on a class so a single `replace` pass is
 * O(n) over the input.
 */
const MARKDOWN_V2_ESCAPE_RE = /[_*[\]()~`>#+\-=|{}.!\\]/g;

/**
 * Escape every MarkdownV2 reserved character with a leading backslash so a
 * user-supplied error message (with `.`, `-`, `(`, `)` etc.) does not break
 * Telegram's parser and produce a 400.
 *
 * Pure / no allocations beyond the replaced string — safe to call hot.
 */
export function escapeMarkdownV2(input: string): string {
  return input.replace(MARKDOWN_V2_ESCAPE_RE, (ch) => `\\${ch}`);
}

/**
 * Truncate text to {@link TELEGRAM_MAX_TEXT} characters. If the input is short
 * enough, return as-is; otherwise cut and append the marker so the receiver can
 * tell the message was clipped.
 */
export function truncateForTelegram(text: string): string {
  if (text.length <= TELEGRAM_MAX_TEXT) return text;
  const cut = TELEGRAM_MAX_TEXT - TRUNCATION_MARKER.length;
  return text.slice(0, Math.max(0, cut)) + TRUNCATION_MARKER;
}

/**
 * Minimal Telegram transport configuration. The bot token and chat id are the
 * only required values; everything else is overridable for tests.
 */
export interface TelegramTransportConfig {
  /** Bot token from @BotFather, e.g. `123456:ABC-DEF...`. */
  botToken: string;
  /** Target chat id. May be a numeric id (`-1001234567890`) or `@channelname`. */
  chatId: string;
  /** Override the API origin in tests. Defaults to api.telegram.org. */
  baseUrl?: string;
  /** Per-request timeout in ms. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/**
 * The signature the AlertingService needs from the transport. Returns `true`
 * when Telegram accepted the call, `false` on any failure (timeout, non-2xx,
 * disabled config). NEVER throws.
 */
export type TelegramSend = (text: string) => Promise<boolean>;

/**
 * Build a {@link TelegramSend} bound to the given config. Returns a no-op
 * function (which always resolves `false`) when the bot token or chat id is
 * blank — the alerting service then becomes a silent passthrough.
 */
export function makeTelegramSender(
  config: TelegramTransportConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
  logger: Logger = new Logger('TelegramTransport'),
): TelegramSend {
  const token = config.botToken?.trim() ?? '';
  const chatId = config.chatId?.trim() ?? '';
  if (token === '' || chatId === '') {
    // Disabled — return a permanent no-op so callers don't have to branch.
    return async () => false;
  }
  const baseUrl = (config.baseUrl ?? TELEGRAM_BASE_URL).replace(/\/+$/, '');
  const endpoint = `${baseUrl}/bot${token}/sendMessage`;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (text: string): Promise<boolean> => {
    const body = JSON.stringify({
      chat_id: chatId,
      text: truncateForTelegram(text),
      parse_mode: 'MarkdownV2',
      // Don't ping every reader on every alert; the channel itself is the signal.
      disable_notification: false,
      disable_web_page_preview: true,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        // Read+drop the body so the response is fully consumed (some runtimes
        // leak the socket otherwise). Logged at warn so a missing alert is
        // visible in production logs without escalating to error noise.
        const detail = await safeReadText(res);
        logger.warn(
          `Telegram sendMessage non-2xx ${res.status}: ${detail.slice(0, 200)}`,
          'TelegramTransport',
        );
        return false;
      }
      return true;
    } catch (err) {
      // AbortError, DNS failure, TLS error — never propagate to caller.
      const e = err as Error;
      logger.warn(`Telegram sendMessage failed: ${e.message}`, 'TelegramTransport');
      return false;
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Drain a Response body to a string, swallowing any error. */
async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
