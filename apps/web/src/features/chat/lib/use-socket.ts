'use client';

/**
 * Feature-local realtime helpers built on the shared socket singleton
 * (`@/lib/socket`). Used by chat AND friends (presence, typing, receipts).
 *
 * ── Connection contract ───────────────────────────────────────────────────
 * The auth feature's `useAuthBootstrap()` is the PRIMARY connector: it calls
 * `connectSocket(token)` on sign-in and `disconnectSocket()` on sign-out, using
 * the access token persisted at `localStorage['ruletka.accessToken']`.
 *
 * `useSocket()` here is a defensive safety net so chat/friends still work if
 * mounted before the bootstrap has connected: it opportunistically connects
 * using a token discovered from, in order:
 *   1. `window.__RULETKA_ACCESS_TOKEN__` (optional global), or
 *   2. `localStorage['ruletka.accessToken']` (the shared key the auth store uses).
 * Both paths are idempotent (the singleton re-handshakes only when needed). If
 * no token exists we still attach listeners and open the connection (the
 * gateway may auth from the credentialed cookie), so subscribers light up the
 * instant the socket connects. Nothing here disconnects the socket.
 */
import { useEffect, useRef } from 'react';
import { connectSocket, getSocket, type AppSocket } from '@/lib/socket';
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
 * Returns the shared socket and ensures a connection attempt has been made.
 * Safe to call from many components — connection is idempotent and the socket
 * is a singleton.
 */
export function useSocket(): AppSocket {
  const socket = getSocket();

  useEffect(() => {
    if (socket.connected) return;
    const token = discoverAccessToken();
    if (token) {
      // Idempotent: re-handshakes with the latest token if needed.
      connectSocket(token);
    } else {
      // No token yet — still open the connection so the gateway can
      // authenticate from a cookie if one is present (withCredentials: true).
      if (!socket.active) socket.connect();
    }
    // We intentionally never disconnect here: the socket is app-global and may
    // be shared with other realtime features (matchmaking, calls).
  }, [socket]);

  return socket;
}

/**
 * Subscribe to a typed server→client event for the lifetime of the component.
 * The handler is kept in a ref so callers can pass inline closures without
 * re-subscribing on every render.
 */
export function useSocketEvent<E extends keyof ServerToClientEvents>(
  event: E,
  handler: ServerToClientEvents[E],
): void {
  const socket = getSocket();
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

/** Typed emit helper (thin wrapper preserving the contract's argument types). */
export function emitSocket<E extends keyof ClientToServerEvents>(
  event: E,
  ...args: Parameters<ClientToServerEvents[E]>
): void {
  getSocket().emit(event, ...args);
}
