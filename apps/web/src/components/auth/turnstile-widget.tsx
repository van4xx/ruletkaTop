'use client';

/**
 * Cloudflare Turnstile — a thin, dependency-free, client-only widget.
 *
 * Anti-abuse CAPTCHA shown on the register form. It is **fully gated** on the
 * public site key:
 *   - If `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is UNSET (dev / local), this renders
 *     NOTHING and the form submits with no token — a pure no-op so the app runs
 *     without any Cloudflare account.
 *   - If set, it lazily injects the official Turnstile script
 *     (`challenges.cloudflare.com/turnstile/v0/api.js`) ONCE, renders the widget
 *     with EXPLICIT rendering, and surfaces the verification token via
 *     {@link TurnstileWidgetProps.onToken}.
 *
 * Tokens are single-use and expire after ~5 min, so we clear the token on
 * expiry/error and let Turnstile auto-refresh — the parent simply submits
 * whatever the latest token is.
 *
 * Why explicit rendering (not the implicit `cf-turnstile` auto-scan): React
 * owns the DOM node, and explicit `turnstile.render(el, …)` lets us bind the
 * callbacks and clean up (`turnstile.remove`) deterministically across
 * mount/unmount and Strict-Mode double-invokes. NOTE: for explicit rendering we
 * must NOT use `turnstile.ready()` (which requires a non-async script); instead
 * we poll for `window.turnstile` becoming available after the script loads.
 */
import { useEffect, useRef, useState } from 'react';

/** Public site key — when absent, the widget is a no-op (dev/local). */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

/** Official Turnstile script URL (explicit-render mode). */
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const SCRIPT_ID = 'cf-turnstile-script';

// Minimal typing of the global Turnstile API surface we use.
interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback?: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
      'timeout-callback'?: () => void;
      theme?: 'auto' | 'light' | 'dark';
      size?: 'normal' | 'flexible' | 'compact';
      appearance?: 'always' | 'execute' | 'interaction-only';
      language?: string;
    },
  ): string;
  remove(widgetId: string): void;
  reset(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** Ensure the Turnstile script tag exists; resolve when `window.turnstile` is ready. */
let scriptPromise: Promise<void> | null = null;
function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;

    // Poll for the global to appear (the script defines it asynchronously).
    const waitForApi = () => {
      const started = Date.now();
      const id = window.setInterval(() => {
        if (window.turnstile) {
          window.clearInterval(id);
          resolve();
        } else if (Date.now() - started > 10_000) {
          window.clearInterval(id);
          reject(new Error('Turnstile script load timeout'));
        }
      }, 50);
    };

    if (existing) {
      if (window.turnstile) resolve();
      else waitForApi();
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = waitForApi;
    script.onerror = () => reject(new Error('Failed to load Turnstile script'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export interface TurnstileWidgetProps {
  /**
   * Receives the verification token (or `null` when cleared/expired). The parent
   * threads this into `registerSchema.captchaToken`.
   */
  onToken: (token: string | null) => void;
  /** Visual theme. Defaults to the app's dark UI. */
  theme?: 'auto' | 'light' | 'dark';
  className?: string;
}

/**
 * Renders the Turnstile challenge when a site key is configured. Returns `null`
 * (renders nothing) when unconfigured — callers can render it unconditionally.
 */
export function TurnstileWidget({ onToken, theme = 'dark', className }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const [failed, setFailed] = useState(false);

  // Keep the latest callback without re-rendering the widget.
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    // Unconfigured → no-op (no script, no widget). The form submits tokenless.
    if (!TURNSTILE_SITE_KEY) return;

    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled) return;
        const el = containerRef.current;
        const api = window.turnstile;
        if (!el || !api) {
          setFailed(true);
          return;
        }
        // Render once. Re-mounts (Strict Mode) clean up via the unmount path.
        widgetIdRef.current = api.render(el, {
          sitekey: TURNSTILE_SITE_KEY,
          theme,
          size: 'flexible',
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'timeout-callback': () => onTokenRef.current(null),
          'error-callback': () => {
            onTokenRef.current(null);
            setFailed(true);
          },
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      const api = window.turnstile;
      const id = widgetIdRef.current;
      if (api && id) {
        try {
          api.remove(id);
        } catch {
          /* widget may already be gone */
        }
      }
      widgetIdRef.current = null;
    };
    // Site key + theme are effectively constant for a mount.
  }, [theme]);

  if (!TURNSTILE_SITE_KEY) return null;

  return (
    <div className={className}>
      <div ref={containerRef} />
      {failed && (
        <p className="mt-1 text-xs text-muted-foreground">
          Не удалось загрузить проверку. Обновите страницу или попробуйте позже.
        </p>
      )}
    </div>
  );
}
