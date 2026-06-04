/**
 * Typed Socket.io client singleton for ruletka.top realtime features
 * (matchmaking, WebRTC signaling, presence, chat, calls, notifications).
 *
 * The socket is strongly typed with the contract event maps from
 * `@ruletka/shared-types`, so `socket.emit` / `socket.on` are checked against
 * {@link ClientToServerEvents} and {@link ServerToClientEvents}.
 *
 * Connection is lazy and manual (`autoConnect: false`): the auth token is sent
 * in the handshake `auth` payload, so callers must set the token and connect
 * once it is known (typically after login / on entering a realtime route).
 *
 * Resilience model:
 *  - Reconnection is ON with exponential backoff + jitter (built into
 *    socket.io's manager) so flaky mobile networks recover automatically.
 *  - The handshake `auth` is a FUNCTION that reads the LIVE access token at
 *    each (re)connection attempt. This re-handshakes the JWT on every reconnect
 *    without manual re-binding, so a token refreshed while offline is picked up
 *    on the next attempt — and never sends a stale token.
 *  - Heartbeat/liveness is handled by engine.io's built-in ping/pong; we tune
 *    the client `timeout` so a dead link is detected promptly rather than
 *    hanging. (We deliberately do NOT add a second app-level ping — that would
 *    duplicate the transport heartbeat and waste battery.)
 */
'use client';

import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@ruletka/shared-types';
import { getAccessToken } from '@/lib/api';

/** Concrete, fully-typed socket instance type used across the app. */
export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * The realtime namespaces the backend exposes. Each is a SEPARATE socket.io
 * connection (one engine.io transport per namespace):
 *  - `/mm`   — matchmaking/roulette (`mm:*`, `rtc:*`), notification delivery
 *    (`notif:new`), moderation (`mod:action`) and presence. The default socket.
 *  - `/chat` — direct messaging (`chat:*`).
 */
export type SocketNamespace = '/mm' | '/chat';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4000';

/**
 * One socket per namespace, created lazily on first {@link getSocket} call.
 * Both connections share the same handshake/auth and reconnection tuning; they
 * are connected and disconnected together by {@link connectSocket} /
 * {@link disconnectSocket} so their lifecycle is owned centrally by login.
 */
const sockets = new Map<SocketNamespace, AppSocket>();

/**
 * The token to present at the NEXT handshake. Kept in module scope (not on
 * `socket.auth`) so the auth callback always reads the freshest value — set by
 * {@link connectSocket} and read lazily by the handshake function below. Shared
 * across namespaces so every connection re-handshakes the same JWT.
 */
let pendingToken: string | null = null;

/**
 * Returns the shared socket for `namespace`, creating it on first use. Safe to
 * call during render — it does not connect until {@link connectSocket} is
 * invoked. Defaults to the primary `/mm` socket (matchmaking + notifications).
 */
export function getSocket(namespace: SocketNamespace = '/mm'): AppSocket {
  let socket = sockets.get(namespace);
  if (!socket) {
    socket = io(`${WS_URL}${namespace}`, {
      autoConnect: false,
      // Prefer WebSocket; fall back to polling only if the upgrade fails.
      transports: ['websocket', 'polling'],
      withCredentials: true,
      // ── Resilient reconnection for flaky mobile networks ──
      reconnection: true,
      reconnectionAttempts: Infinity,
      // Backoff grows 0.5s → 1s → 2s → … capped at 5s.
      reconnectionDelay: 500,
      reconnectionDelayMax: 5_000,
      // ±50% jitter on each delay so a fleet of clients doesn't reconnect in
      // lockstep (thundering herd) after a server blip.
      randomizationFactor: 0.5,
      // Fail a connection attempt that stalls past 20s so backoff kicks in
      // instead of hanging on a half-open socket.
      timeout: 20_000,
      // Re-handshake the JWT on EVERY (re)connection attempt by reading the
      // live access token lazily. A token refreshed while we were offline is
      // therefore presented on the next attempt; a logout (null token) is
      // surfaced to the gateway, which rejects the handshake.
      auth: (cb: (data: { token: string | null }) => void) => {
        cb({ token: pendingToken ?? getAccessToken() });
      },
    });
    sockets.set(namespace, socket);
  }
  return socket;
}

/** The namespaces opened app-wide on login (and torn down on logout). */
const MANAGED_NAMESPACES: readonly SocketNamespace[] = ['/mm', '/chat'];

/**
 * Sets the bearer token used in the handshake and (re)connects EVERY managed
 * namespace (`/mm` + `/chat`).
 *
 * The token is stored in module scope and read lazily by each handshake
 * function, so reconnect attempts always use the freshest credentials. Passing
 * `null` clears the token and disconnects all namespaces.
 *
 * Returns the primary `/mm` socket for callers that want a handle.
 */
export function connectSocket(accessToken: string | null): AppSocket {
  if (!accessToken) {
    pendingToken = null;
    disconnectSocket();
    return getSocket('/mm');
  }
  const tokenChanged = pendingToken !== accessToken;
  pendingToken = accessToken;
  for (const namespace of MANAGED_NAMESPACES) {
    const s = getSocket(namespace);
    if (s.connected && tokenChanged) {
      // Credentials changed mid-session (e.g. a token refresh): force a clean
      // re-handshake so the gateway re-authenticates with the new token. If the
      // token is unchanged, leave the live connection untouched (no flap).
      s.disconnect();
      s.connect();
    } else if (!s.connected) {
      s.connect();
    }
  }
  return getSocket('/mm');
}

/**
 * Disconnects ALL namespaced sockets if connected, and clears the pending
 * token. Idempotent. Only sockets already created are touched (we don't spin up
 * a connection just to disconnect it).
 */
export function disconnectSocket(): void {
  pendingToken = null;
  for (const s of sockets.values()) {
    s.disconnect();
  }
}
