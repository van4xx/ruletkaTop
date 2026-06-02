/**
 * Shared types for the roulette feature (/video + /voice).
 */
import type { MatchFilters, MatchType, PeerInfo } from '@ruletka/shared-types';
import type { MediaErrorKind, QualityLevel, QualitySample } from '@/lib/webrtc';

export type { QualityLevel, QualitySample };

/**
 * The roulette session lifecycle, driving every piece of UI chrome:
 *
 *  idle        — not started; show the pre-flight / start screen.
 *  requesting  — acquiring camera/mic permission.
 *  searching   — in the matchmaking queue, waiting for `mm:matched`.
 *  connecting   — matched; exchanging SDP/ICE, peer connection not yet live.
 *  connected    — media flowing both ways.
 *  reconnecting — a live call's transport dropped; we're attempting an
 *                 ICE-restart recovery (grace timer / renegotiation) and hope to
 *                 resume the SAME call. Distinct from 'connecting' (first setup).
 *  ended        — the peer hung up / disconnected; brief interstitial before
 *                 auto-requeue or manual action.
 *  error        — media permission / device failure; show recovery UI.
 */
export type RouletteStatus =
  | 'idle'
  | 'requesting'
  | 'searching'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'ended'
  | 'error';

export interface RouletteError {
  kind: MediaErrorKind | 'socket' | 'timeout';
  message: string;
}

export interface RouletteState {
  status: RouletteStatus;
  /** The current matched room id (signaling scope), or null. */
  roomId: string | null;
  /** Info about the current peer for the call overlay, or null. */
  peer: PeerInfo | null;
  /** Live local media stream (camera/mic), or null. */
  localStream: MediaStream | null;
  /** Live remote media stream, or null. */
  remoteStream: MediaStream | null;
  /** Whether the socket is currently connected. */
  socketConnected: boolean;
  /** Local mic muted? */
  micMuted: boolean;
  /** Local camera off? (video mode only) */
  cameraOff: boolean;
  /** Optional queue position hint from `mm:waiting`. */
  positionHint: number | null;
  /**
   * Live connection-quality sample for the current call (RTT/loss/jitter →
   * level), or null when not connected / not yet measured. Drives the in-call
   * signal-bars indicator.
   */
  quality: QualitySample | null;
  /**
   * Which ICE-restart recovery attempt we're on (1-based) while
   * status === 'reconnecting'; 0 otherwise. Lets the UI show progress.
   */
  reconnectAttempt: number;
  /** Last error, when status === 'error'. */
  error: RouletteError | null;
  /** In-call ephemeral chat messages (peer-to-peer data channel). */
  chatMessages: ChatLine[];
  /** Whether the in-call chat data channel is open. */
  chatOpen: boolean;
}

/** A single ephemeral in-call chat line (not persisted). */
export interface ChatLine {
  id: string;
  from: 'me' | 'peer';
  text: string;
  at: number;
}

export interface UseRouletteOptions {
  type: MatchType;
  /** Access token for the socket handshake. */
  token: string | null;
}

export interface UseRouletteResult extends RouletteState {
  filters: MatchFilters;
  setFilters: (next: MatchFilters) => void;
  /**
   * Best-effort, silent pre-acquisition of camera/mic + ICE servers before the
   * user hits Start, so the connect is instant. Safe to call repeatedly; no-ops
   * once a session is active or media is live. Failures are swallowed (start()
   * surfaces the real error).
   */
  prewarm: () => void;
  /** Begin: acquire media, connect socket, join the queue. */
  start: () => Promise<void>;
  /** Skip the current peer and search for the next one. */
  next: () => void;
  /** Stop everything: leave queue, stop media, close peer. */
  stop: () => void;
  /** Toggle the local microphone. */
  toggleMic: () => void;
  /** Toggle the local camera (video mode). */
  toggleCamera: () => void;
  /** Send an in-call chat message (peer-to-peer). Returns false if unavailable. */
  sendChatMessage: (text: string) => boolean;
  /** Show/hide the in-call chat panel. */
  setChatOpen: (open: boolean) => void;
  /** True while a start() call is acquiring media. */
  isStarting: boolean;
}

export const DEFAULT_FILTERS: MatchFilters = {
  gender: 'any',
  ageMin: 18,
  ageMax: 100,
  countries: [],
  sharedInterestsOnly: false,
};
