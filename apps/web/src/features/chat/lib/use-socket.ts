'use client';

/**
 * Feature-local realtime helpers built on the shared socket singletons
 * (`@/lib/socket`). Used across chat, friends/presence, notifications,
 * moderation and calls.
 *
 * ── Namespaces ────────────────────────────────────────────────────────────
 * The backend splits realtime over two namespaces, so each helper takes a
 * `namespace` argument selecting which socket to bind to:
 *   - `/chat` (the DEFAULT here, since these helpers live in the chat feature)
 *     carries `chat:*`.
 *   - `/mm` carries matchmaking/`rtc:*`, `notif:new`, `mod:action`, presence
 *     and (eventually) `call:*`.
 * Consumers of `/mm`-delivered events MUST pass `'/mm'` explicitly, or they
 * will subscribe on the wrong connection and never hear the event.
 *
 * ── Connection contract ───────────────────────────────────────────────────
 * The auth feature's `useAuthBootstrap()` is the PRIMARY connector: it calls
 * `connectSocket(token)` on sign-in and `disconnectSocket()` on sign-out (which
 * open/close BOTH namespaces), using the access token persisted at
 * `localStorage['ruletka.accessToken']`.
 *
 * `useSocket()` here is a defensive safety net so subscribers still work if
 * mounted before the bootstrap has connected: it opportunistically connects
 * using a token discovered from, in order:
 *   1. `window.__RULETKA_ACCESS_TOKEN__` (optional global), or
 *   2. `localStorage['ruletka.accessToken']` (the shared key the auth store uses).
 * Both paths are idempotent (the singletons re-handshake only when needed). If
 * no token exists we still attach listeners and open the connection (the
 * gateway may auth from the credentialed cookie), so subscribers light up the
 * instant the socket connects. Nothing here disconnects the socket.
 */
import { useEffect, useRef } from 'react';
import { connectSocket, getSocket, type AppSocket, type SocketNamespace } from '@/lib/socket';
import type { ClientToServerEvents, ServerToClientEvents } from '@ruletka/shared-types';

const TOKEN_GLOBAL = '__RULETKA_ACCESS_TOKEN__';
const TOKEN_STORAGE_KEY = 'ruletka.accessToken';

declare global {
  interface Window {
    [TOKEN_GLOBAL]?: string | null;
  }
}

/** Best-effort discovery of an access token for the socket handshake. */
export function discoverAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  const fromGlobal = window[TOKEN_GLOBAL];
  if (fromGlobal) return fromGlobal;
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Returns the shared socket for `namespace` (default `/chat`) and ensures a
 * connection attempt has been made. Safe to call from many components —
 * connection is idempotent and each namespace socket is a singleton.
 */
export function useSocket(namespace: SocketNamespace = '/chat'): AppSocket {
  const socket = getSocket(namespace);

  useEffect(() => {
    if (socket.connected) return;
    const token = discoverAccessToken();
    if (token) {
      // Idempotent: re-handshakes BOTH namespaces with the latest token if
      // needed (so a single subscriber boots the whole realtime layer).
      connectSocket(token);
    } else {
      // No token yet — still open this connection so the gateway can
      // authenticate from a cookie if one is present (withCredentials: true).
      if (!socket.active) socket.connect();
    }
    // We intentionally never disconnect here: the sockets are app-global and
    // shared with other realtime features (matchmaking, notifications, calls).
  }, [socket]);

  return socket;
}

/**
 * Subscribe to a typed server→client event for the lifetime of the component,
 * on `namespace` (default `/chat`). The handler is kept in a ref so callers can
 * pass inline closures without re-subscribing on every render.
 *
 * NOTE: bind to the namespace that actually carries `event` — e.g. `notif:new`,
 * `mod:action` and `presence:*` are delivered on `/mm`.
 */
export function useSocketEvent<E extends keyof ServerToClientEvents>(
  event: E,
  handler: ServerToClientEvents[E],
  namespace: SocketNamespace = '/chat',
): void {
  const socket = getSocket(namespace);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    // Stable listener delegates to the latest handler.
    const listener = (...args: unknown[]) => {
      (handlerRef.current as (...a: unknown[]) => void)(...args);
    };

    // socket.io's generic on/off overloads don't narrow well over a generic
    // event key, so bind through a loosely-typed view. The PUBLIC signature of
    // this hook stays fully typed against ServerToClientEvents.
    const emitter = socket as unknown as {
      on(event: string, listener: (...a: unknown[]) => void): void;
      off(event: string, listener: (...a: unknown[]) => void): void;
    };
    emitter.on(event as string, listener);
    return () => {
      emitter.off(event as string, listener);
    };
  }, [socket, event]);
}

/**
 * Typed emit helper (thin wrapper preserving the contract's argument types).
 * Emits on `namespace` (default `/chat`); pass `'/mm'` for events whose gateway
 * lives there (e.g. `presence:subscribe`). The `namespace` is the FIRST arg so
 * the trailing contract args stay correctly typed via the rest parameter.
 */
export function emitSocketOn<E extends keyof ClientToServerEvents>(
  namespace: SocketNamespace,
  event: E,
  ...args: Parameters<ClientToServerEvents[E]>
): void {
  getSocket(namespace).emit(event, ...args);
}

/** Typed emit on the default `/chat` namespace. See {@link emitSocketOn}. */
export function emitSocket<E extends keyof ClientToServerEvents>(
  event: E,
  ...args: Parameters<ClientToServerEvents[E]>
): void {
  emitSocketOn('/chat', event, ...args);
}
