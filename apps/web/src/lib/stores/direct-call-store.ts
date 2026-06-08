'use client';

/**
 * Direct (friend) call hand-off store.
 *
 * Direct 1:1 calls are placed from OUTSIDE the roulette stage — a friend card /
 * chat-thread "video" button deep-links to `/video?to=<userId>` (the caller),
 * and the global incoming-call modal's Accept button (the callee) — but the
 * WebRTC engine that actually runs the call lives in {@link useRoulette} on the
 * `/video` (or `/voice`) page. This tiny zustand store is the hand-off channel
 * between those two worlds: the entry point records a {@link DirectCallIntent},
 * navigates to the roulette page, and the `useRoulette` instance there *drains*
 * the intent and runs a DIRECT call (bypassing the matchmaking queue) over the
 * already-existing `call:*` + `rtc:*` socket contract.
 *
 * Why a store (not a query param alone): the callee path carries a `callId` and
 * a role that don't belong in a shareable URL, and the caller path needs the
 * intent to survive the client-side navigation to `/video` without re-triggering
 * on a refresh. Keeping it in module/zustand state (consumed exactly once via
 * {@link consumeDirectCall}) matches how the rest of the app coordinates
 * cross-component intent (see `modal-store`).
 *
 * Lifecycle: the intent is set right before navigation and consumed once by the
 * roulette engine on mount/param-change. It is intentionally NOT persisted — a
 * page refresh drops a stale intent (a refreshed caller simply re-initiates from
 * the `?to=` param; a refreshed callee's ring has already rung out server-side).
 */
import { create } from 'zustand';
import type { MatchType } from '@ruletka/shared-types';

/**
 * Who we are in a direct call:
 *  - `caller` — we pressed "video call" on a friend; we will emit `call:invite`
 *    and, once the callee accepts (`call:accept`), drive the SDP offer.
 *  - `callee` — we accepted an incoming invite (`call:accept` already emitted by
 *    the modal); we answer the caller's offer. We already hold the `callId`.
 */
export type DirectCallRole = 'caller' | 'callee';

/** A pending direct-call hand-off, consumed once by the roulette engine. */
export interface DirectCallIntent {
  role: DirectCallRole;
  /** The other party. For a caller this is the invitee; for a callee, the caller. */
  peerUserId: string;
  /** Modality — must match the roulette page the engine runs on. */
  type: MatchType;
  /**
   * The call id. Present for the `callee` (it came in on the invite and the
   * `call:<callId>` room is the signaling scope). Absent for the `caller`, who
   * only learns it when the server relays `call:accept { callId }`.
   */
  callId?: string;
}

interface DirectCallState {
  intent: DirectCallIntent | null;
  /** Record a pending direct call (replacing any prior, un-consumed one). */
  set: (intent: DirectCallIntent) => void;
  /** Clear without consuming (e.g. the engine tore down before draining). */
  clear: () => void;
}

export const useDirectCallStore = create<DirectCallState>((set) => ({
  intent: null,
  set: (intent) => set({ intent }),
  clear: () => set({ intent: null }),
}));

/**
 * Imperatively record a direct-call intent (for use in event handlers outside
 * React render, e.g. the call-invite modal). Equivalent to `set` on the store.
 */
export function setDirectCallIntent(intent: DirectCallIntent): void {
  useDirectCallStore.getState().set(intent);
}

/**
 * Atomically read AND clear the pending intent (returns it, or `null`). The
 * roulette engine calls this exactly once so a single hand-off can never be
 * replayed (e.g. by an effect re-running) into a second call.
 */
export function consumeDirectCall(): DirectCallIntent | null {
  const { intent, clear } = useDirectCallStore.getState();
  if (intent) clear();
  return intent;
}
