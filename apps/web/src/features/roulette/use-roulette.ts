'use client';

/**
 * useRoulette — the orchestration engine behind /video and /voice.
 *
 * Owns the full session lifecycle and bridges three subsystems:
 *   1. Matchmaking signaling over the typed socket (`mm:*`, `rtc:*`).
 *   2. Local media (getUserMedia) lifecycle.
 *   3. A per-match {@link PeerConnectionManager} (SDP + ICE).
 *
 * Flow:
 *   start() → getUserMedia → connectSocket(token) → emit `mm:join {type, filters}`
 *   ← `mm:waiting`  → status 'searching'
 *   ← `mm:matched {roomId, peer, isInitiator}`
 *        build PeerConnectionManager(iceServers), add local tracks
 *        if isInitiator: createOffer → emit `rtc:offer`
 *        else: wait for `rtc:offer` → setRemoteDescription → createAnswer → emit `rtc:answer`
 *   ⇄ `rtc:ice-candidate` both directions (queued until remoteDescription set)
 *   ← `rtc:hangup` / socket disconnect → status 'ended' → auto-requeue
 *   next()  → `rtc:hangup` + close peer + emit `mm:next`
 *   stop()  → `mm:leave` + close peer + stop all tracks
 *
 * Everything is torn down deterministically on stop()/next()/unmount. NOTE:
 * leaving a session does NOT disconnect the shared `/mm` socket — its lifecycle
 * is owned by login/logout, and notifications + chat ride on it app-wide, so we
 * only exit the queue/match (`mm:leave`) and tear down this hook's own listeners
 * and local media.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type {
  MatchFilters,
  MmMatchedPayload,
  RtcIcePayload,
  RtcOfferPayload,
} from '@ruletka/shared-types';

import { getSocket, connectSocket } from '@/lib/socket';
import { api } from '@/lib/api';
import {
  FALLBACK_ICE_SERVERS,
  getLocalStream,
  MediaError,
  PeerConnectionManager,
  stopStream,
  type IceServerConfig,
  type QualitySample,
  type TurnCredentials,
} from '@/lib/webrtc';
import { track } from '@/lib/analytics';

import {
  DEFAULT_FILTERS,
  type ChatLine,
  type RouletteState,
  type UseRouletteOptions,
  type UseRouletteResult,
} from './types';

// ───────────────────────────── Reducer ────────────────────────────────
type Action =
  | { type: 'RESET' }
  | { type: 'REQUESTING' }
  | { type: 'LOCAL_STREAM'; stream: MediaStream }
  | { type: 'SEARCHING' }
  | { type: 'WAITING'; positionHint: number | null }
  | { type: 'MATCHED'; roomId: string; peer: MmMatchedPayload['peer'] }
  | { type: 'REMOTE_STREAM'; stream: MediaStream }
  | { type: 'CONNECTED' }
  | { type: 'RECONNECTING'; attempt: number }
  | { type: 'QUALITY'; sample: QualitySample | null }
  | { type: 'ENDED' }
  | { type: 'CLEAR_MATCH' }
  | { type: 'SOCKET'; connected: boolean }
  | { type: 'MIC'; muted: boolean }
  | { type: 'CAMERA'; off: boolean }
  | { type: 'CHAT_OPEN'; open: boolean }
  | { type: 'CHAT_ADD'; line: ChatLine }
  | { type: 'CHAT_CLEAR' }
  | { type: 'ERROR'; error: RouletteState['error'] };

const initialState: RouletteState = {
  status: 'idle',
  roomId: null,
  peer: null,
  localStream: null,
  remoteStream: null,
  socketConnected: false,
  micMuted: false,
  cameraOff: false,
  positionHint: null,
  quality: null,
  reconnectAttempt: 0,
  error: null,
  chatMessages: [],
  chatOpen: false,
};

function reducer(state: RouletteState, action: Action): RouletteState {
  switch (action.type) {
    case 'RESET':
      return {
        ...initialState,
        localStream: state.localStream,
        socketConnected: state.socketConnected,
      };
    case 'REQUESTING':
      return { ...state, status: 'requesting', error: null };
    case 'LOCAL_STREAM':
      return { ...state, localStream: action.stream };
    case 'SEARCHING':
      return {
        ...state,
        status: 'searching',
        roomId: null,
        peer: null,
        remoteStream: null,
        positionHint: null,
        quality: null,
        reconnectAttempt: 0,
        error: null,
        chatMessages: [],
        chatOpen: false,
      };
    case 'WAITING':
      return { ...state, status: 'searching', positionHint: action.positionHint };
    case 'MATCHED':
      return {
        ...state,
        status: 'connecting',
        roomId: action.roomId,
        peer: action.peer,
        remoteStream: null,
        quality: null,
        reconnectAttempt: 0,
        chatMessages: [],
        chatOpen: false,
      };
    case 'REMOTE_STREAM':
      return { ...state, remoteStream: action.stream };
    case 'CONNECTED':
      // Resuming after a reconnect (or first connect) → clear recovery state.
      return { ...state, status: 'connected', reconnectAttempt: 0 };
    case 'RECONNECTING':
      return { ...state, status: 'reconnecting', reconnectAttempt: action.attempt };
    case 'QUALITY':
      return { ...state, quality: action.sample };
    case 'ENDED':
      return { ...state, status: 'ended', remoteStream: null, quality: null, reconnectAttempt: 0 };
    case 'CLEAR_MATCH':
      return { ...state, roomId: null, peer: null, remoteStream: null, quality: null };
    case 'SOCKET':
      return { ...state, socketConnected: action.connected };
    case 'MIC':
      return { ...state, micMuted: action.muted };
    case 'CAMERA':
      return { ...state, cameraOff: action.off };
    case 'CHAT_OPEN':
      return { ...state, chatOpen: action.open };
    case 'CHAT_ADD':
      return { ...state, chatMessages: [...state.chatMessages, action.line] };
    case 'CHAT_CLEAR':
      return { ...state, chatMessages: [], chatOpen: false };
    case 'ERROR':
      return { ...state, status: 'error', error: action.error };
    default:
      return state;
  }
}

/** How long we wait for a match before surfacing a soft timeout hint. */
const MATCH_TIMEOUT_MS = 30_000;
/** Auto-requeue delay after a peer hangs up. */
const REQUEUE_DELAY_MS = 1_200;

// ── Reconnection (ICE-restart) tuning ──
/**
 * On `iceConnectionState === 'disconnected'` we wait this long for the link to
 * self-heal (transient network blip, Wi-Fi → cellular handoff) before forcing
 * an ICE restart. A 'failed' state skips the wait and restarts immediately.
 */
const ICE_GRACE_MS = 2_500;
/** Max ICE-restart attempts before we give up and surface a "lost" call. */
const MAX_ICE_RESTARTS = 2;
/**
 * How long to wait for a restart to (re)connect before counting it as failed
 * and trying again (or giving up). Generous enough for a fresh TURN allocation.
 */
const ICE_RESTART_TIMEOUT_MS = 10_000;
/** Cadence of the in-call quality sampler. */
const QUALITY_POLL_MS = 2_000;

export function useRoulette({ type, token }: UseRouletteOptions): UseRouletteResult {
  const t = useTranslations('roulette');
  const isVideo = type === 'video';
  const [state, dispatch] = useReducer(reducer, initialState);
  const [filters, setFilters] = useState<MatchFilters>(DEFAULT_FILTERS);
  const [isStarting, setIsStarting] = useState(false);

  // ── Refs holding live, non-render objects ──
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<PeerConnectionManager | null>(null);
  const roomIdRef = useRef<string | null>(null);
  const isInitiatorRef = useRef(false);
  const iceServersRef = useRef<IceServerConfig[] | null>(null);
  const startedRef = useRef(false); // session active (between start and stop)
  const joinedRef = useRef(false); // an initial mm:join has been emitted
  const filtersRef = useRef<MatchFilters>(filters);
  const matchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requeueTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Reconnection (ICE-restart) machinery ──
  const iceGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iceRestartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iceRestartCountRef = useRef(0); // attempts used for the current match
  const reconnectingRef = useRef(false); // a recovery is in flight
  // ── Quality sampler ──
  const qualityTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // ── Media pre-warm ──
  // A getUserMedia call may already be in flight (prewarm racing start, or a
  // double prewarm). We coalesce onto a single promise so we never open two
  // camera streams (which would leave a dangling camera light).
  const acquiringRef = useRef<Promise<MediaStream> | null>(null);

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  // ── Timeout helpers ──
  const clearMatchTimeout = useCallback(() => {
    if (matchTimeoutRef.current) {
      clearTimeout(matchTimeoutRef.current);
      matchTimeoutRef.current = null;
    }
  }, []);
  const clearRequeueTimeout = useCallback(() => {
    if (requeueTimeoutRef.current) {
      clearTimeout(requeueTimeoutRef.current);
      requeueTimeoutRef.current = null;
    }
  }, []);

  // ── Reconnection / quality teardown helpers ──
  const clearReconnectTimers = useCallback(() => {
    if (iceGraceTimerRef.current) {
      clearTimeout(iceGraceTimerRef.current);
      iceGraceTimerRef.current = null;
    }
    if (iceRestartTimeoutRef.current) {
      clearTimeout(iceRestartTimeoutRef.current);
      iceRestartTimeoutRef.current = null;
    }
  }, []);
  const stopQualityPolling = useCallback(() => {
    if (qualityTimerRef.current) {
      clearInterval(qualityTimerRef.current);
      qualityTimerRef.current = null;
    }
  }, []);

  // ── Peer teardown (does NOT stop local media) ──
  const closePeer = useCallback(() => {
    clearReconnectTimers();
    stopQualityPolling();
    iceRestartCountRef.current = 0;
    reconnectingRef.current = false;
    peerRef.current?.close();
    peerRef.current = null;
    roomIdRef.current = null;
    isInitiatorRef.current = false;
  }, [clearReconnectTimers, stopQualityPolling]);

  // ── Build a peer connection for the current match and kick off negotiation ─
  const beginNegotiation = useCallback(
    async (matched: MmMatchedPayload) => {
      const socket = getSocket('/mm');
      const local = localStreamRef.current;
      const iceServers = iceServersRef.current ?? FALLBACK_ICE_SERVERS;

      // Defensive: a stale match for a closed session.
      if (!startedRef.current) return;

      const manager = new PeerConnectionManager(
        iceServers,
        {
          onIceCandidate: (candidate) => {
            if (roomIdRef.current) {
              socket.emit('rtc:ice-candidate', {
                roomId: roomIdRef.current,
                candidate,
              });
            }
          },
          onTrack: (stream) => dispatch({ type: 'REMOTE_STREAM', stream }),
          onConnectionStateChange: (connState) => {
            if (connState === 'connected') {
              clearMatchTimeout();
              // A 'connected' edge also means any in-flight ICE-restart recovery
              // succeeded — clear the recovery state and resume quality polling.
              onIceHealthyRef.current();
              dispatch({ type: 'CONNECTED' });
              startQualityPollingRef.current();
            } else if (connState === 'closed') {
              // Local teardown → treat as a peer drop (auto-requeue elsewhere).
              handlePeerGoneRef.current();
            }
            // NOTE: 'failed' is handled via onIceConnectionStateChange so we can
            // attempt an ICE restart BEFORE declaring the call dead. The
            // aggregate 'failed' is intentionally not a hard drop here.
          },
          onIceConnectionStateChange: (iceState) => {
            if (iceState === 'connected' || iceState === 'completed') {
              onIceHealthyRef.current();
            } else if (iceState === 'disconnected' || iceState === 'failed') {
              onIceTroubleRef.current(iceState);
            }
          },
          onDataMessage: (text) =>
            dispatch({
              type: 'CHAT_ADD',
              line: { id: crypto.randomUUID(), from: 'peer', text, at: Date.now() },
            }),
        },
        { isInitiator: matched.isInitiator, withChat: true },
      );
      peerRef.current = manager;

      if (local) manager.addLocalStream(local);

      if (matched.isInitiator) {
        const sdp = await manager.createOffer();
        if (roomIdRef.current) socket.emit('rtc:offer', { roomId: roomIdRef.current, sdp });
      }
      // Non-initiator waits for `rtc:offer` (handled in the socket effect).
    },
    // handlePeerGone defined below; included via ref pattern to avoid cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clearMatchTimeout],
  );

  // Forward refs for actions defined later, so socket/timeout handlers bound
  // once can always call the latest implementation without re-binding.
  const handlePeerGoneRef = useRef<() => void>(() => undefined);
  const nextRef = useRef<() => void>(() => undefined);
  // Reconnection handlers (defined below; referenced from the connection-state
  // callback wired inside beginNegotiation via these stable refs).
  const onIceTroubleRef = useRef<(state: RTCIceConnectionState) => void>(() => undefined);
  const onIceHealthyRef = useRef<() => void>(() => undefined);
  const startQualityPollingRef = useRef<() => void>(() => undefined);
  const handlePeerGone = useCallback(() => {
    if (!startedRef.current) return;
    closePeer();
    dispatch({ type: 'ENDED' });
    // Auto-requeue after a short beat so the user sees "собеседник отключился".
    clearRequeueTimeout();
    requeueTimeoutRef.current = setTimeout(() => {
      if (!startedRef.current) return;
      requeue();
    }, REQUEUE_DELAY_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closePeer, clearRequeueTimeout]);
  useEffect(() => {
    handlePeerGoneRef.current = handlePeerGone;
  }, [handlePeerGone]);

  // ── ICE-restart reconnection ────────────────────────────────────────────
  // Perform ONE ICE-restart attempt. Only the initiator drives renegotiation
  // (no glare in our 1↔1 topology); the answerer simply re-answers the re-offer
  // via the existing `rtc:offer`/`rtc:answer` handlers. We start a watchdog: if
  // the connection isn't healthy again within ICE_RESTART_TIMEOUT_MS we either
  // try again or, once attempts are exhausted, declare the call lost.
  const attemptIceRestart = useCallback(() => {
    const manager = peerRef.current;
    if (!startedRef.current || !manager || manager.isClosed) return;

    iceRestartCountRef.current += 1;
    const attempt = iceRestartCountRef.current;
    reconnectingRef.current = true;
    dispatch({ type: 'RECONNECTING', attempt });

    // Only the initiator emits a renegotiation offer. The answerer just waits;
    // its existing onOffer handler will produce a fresh answer. We use
    // createOffer({ iceRestart: true }) — the portable path that mints fresh ICE
    // credentials (new ufrag/pwd) AND produces the offer we relay over the
    // existing rtc:offer channel. (pc.restartIce() alone wouldn't emit an offer
    // in our manual-signaling setup since we don't listen to negotiationneeded.)
    if (isInitiatorRef.current) {
      const socket = getSocket('/mm');
      void manager
        .createOffer({ iceRestart: true })
        .then((sdp) => {
          if (roomIdRef.current && !manager.isClosed) {
            socket.emit('rtc:offer', { roomId: roomIdRef.current, sdp });
          }
        })
        .catch(() => {
          /* swallow — the watchdog will retry or give up */
        });
    }

    // Watchdog for this attempt.
    if (iceRestartTimeoutRef.current) clearTimeout(iceRestartTimeoutRef.current);
    iceRestartTimeoutRef.current = setTimeout(() => {
      const m = peerRef.current;
      if (!startedRef.current || !m || m.isClosed) return;
      const ice = m.iceConnectionState;
      if (ice === 'connected' || ice === 'completed') return; // recovered
      if (iceRestartCountRef.current < MAX_ICE_RESTARTS) {
        attemptIceRestart();
      } else {
        // Exhausted — give up on THIS peer and fall back to the normal
        // peer-gone path (ended → auto-requeue → Next still available).
        reconnectingRef.current = false;
        handlePeerGoneRef.current();
      }
    }, ICE_RESTART_TIMEOUT_MS);
  }, []);

  // Transport went 'disconnected'/'failed'. 'disconnected' is often transient,
  // so we give it a short grace period to self-heal before forcing a restart;
  // 'failed' is terminal for the current ICE generation → restart immediately.
  const onIceTrouble = useCallback(
    (iceState: RTCIceConnectionState) => {
      if (!startedRef.current || !peerRef.current) return;
      // A restart is already in flight — let its watchdog run.
      if (reconnectingRef.current) return;

      if (iceState === 'failed') {
        clearReconnectTimers();
        attemptIceRestart();
        return;
      }
      // 'disconnected': start (or keep) the grace timer.
      if (iceGraceTimerRef.current) return;
      iceGraceTimerRef.current = setTimeout(() => {
        iceGraceTimerRef.current = null;
        const m = peerRef.current;
        if (!startedRef.current || !m || m.isClosed) return;
        const ice = m.iceConnectionState;
        // Self-healed during the grace window → nothing to do.
        if (ice === 'connected' || ice === 'completed') return;
        attemptIceRestart();
      }, ICE_GRACE_MS);
    },
    [attemptIceRestart, clearReconnectTimers],
  );

  // Transport recovered (first connect OR after a restart). Cancel any pending
  // grace/restart timers and clear the reconnecting flag. If we were recovering,
  // drive the UI back to 'connected' here too: some browsers flap only the ICE
  // layer (disconnected→connected) without re-firing the aggregate
  // connectionState, so relying solely on the connection-state callback could
  // leave the UI stuck on 'reconnecting'. CONNECTED is idempotent.
  const onIceHealthy = useCallback(() => {
    clearReconnectTimers();
    if (reconnectingRef.current) {
      reconnectingRef.current = false;
      iceRestartCountRef.current = 0;
      if (peerRef.current && !peerRef.current.isClosed) {
        clearMatchTimeout();
        dispatch({ type: 'CONNECTED' });
        startQualityPollingRef.current();
      }
    }
  }, [clearReconnectTimers, clearMatchTimeout]);

  useEffect(() => {
    onIceTroubleRef.current = onIceTrouble;
    onIceHealthyRef.current = onIceHealthy;
  }, [onIceTrouble, onIceHealthy]);

  // ── Connection-quality sampler ──────────────────────────────────────────
  // Poll getStats() on a steady cadence while a peer connection exists. Safe to
  // call repeatedly: clears any prior interval first, and each tick no-ops if
  // the peer was torn down. Stopped on teardown via stopQualityPolling().
  const startQualityPolling = useCallback(() => {
    stopQualityPolling();
    qualityTimerRef.current = setInterval(() => {
      const manager = peerRef.current;
      if (!manager || manager.isClosed) return;
      void manager
        .sampleQuality()
        .then((sample) => {
          // Drop late samples that resolve after teardown.
          if (peerRef.current === manager && !manager.isClosed) {
            dispatch({ type: 'QUALITY', sample });
          }
        })
        .catch(() => {
          /* getStats can transiently fail during renegotiation — ignore */
        });
    }, QUALITY_POLL_MS);
  }, [stopQualityPolling]);
  useEffect(() => {
    startQualityPollingRef.current = startQualityPolling;
  }, [startQualityPolling]);

  // ── Re-enter the matchmaking queue after the PEER left (room already torn
  //    down server-side). We must re-`mm:join`, since `mm:next` only re-queues
  //    when the caller still has an active room. ──
  const requeue = useCallback(() => {
    if (!startedRef.current) return;
    const socket = getSocket('/mm');
    dispatch({ type: 'SEARCHING' });
    clearMatchTimeout();
    matchTimeoutRef.current = setTimeout(() => {
      // Soft timeout: stay searching but signal it to the UI as a hint.
      dispatch({ type: 'WAITING', positionHint: null });
    }, MATCH_TIMEOUT_MS);
    socket.emit('mm:join', { type, filters: filtersRef.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearMatchTimeout, type]);

  // ── Fetch ICE servers (cached on the ref for the session) ──
  const ensureIceServers = useCallback(async () => {
    if (iceServersRef.current) return;
    try {
      const creds = await api.request<TurnCredentials>('/turn/credentials');
      iceServersRef.current =
        creds.iceServers?.length > 0 ? creds.iceServers : FALLBACK_ICE_SERVERS;
    } catch {
      iceServersRef.current = FALLBACK_ICE_SERVERS;
    }
  }, []);

  // ───────────────────────── Socket event wiring ───────────────────────
  // Bound once per session start (re-bound if `type` changes).
  useEffect(() => {
    const socket = getSocket('/mm');

    const onConnect = () => {
      dispatch({ type: 'SOCKET', connected: true });
      // The queue join is driven entirely off (re)connect: emit `mm:join`
      // whenever an active session has no live match. This covers the initial
      // join AND recovers our slot after a reconnect that happened while
      // searching (the server drops queue entries on disconnect). Mid-match
      // reconnects are skipped here — the peer-gone path requeues those.
      if (startedRef.current && !peerRef.current && !roomIdRef.current) {
        joinedRef.current = true;
        dispatch({ type: 'SEARCHING' });
        clearMatchTimeout();
        matchTimeoutRef.current = setTimeout(() => {
          dispatch({ type: 'WAITING', positionHint: null });
        }, MATCH_TIMEOUT_MS);
        socket.emit('mm:join', { type, filters: filtersRef.current });
      }
    };
    const onDisconnect = () => {
      dispatch({ type: 'SOCKET', connected: false });
      // A mid-call disconnect ends the current match; the socket singleton
      // auto-reconnects and we requeue (handlePeerGone schedules an mm:join).
      if (startedRef.current && peerRef.current) {
        handlePeerGoneRef.current();
      }
    };

    const onWaiting = (p: { positionHint?: number }) => {
      clearMatchTimeout();
      matchTimeoutRef.current = setTimeout(() => {
        dispatch({ type: 'WAITING', positionHint: null });
      }, MATCH_TIMEOUT_MS);
      dispatch({ type: 'WAITING', positionHint: p.positionHint ?? null });
    };

    const onMatched = (p: MmMatchedPayload) => {
      if (!startedRef.current) return;
      clearRequeueTimeout();
      clearMatchTimeout();
      // Negotiation timeout: if media never connects, skip this match cleanly
      // (server-side teardown + re-queue) rather than leaving a half-open room.
      matchTimeoutRef.current = setTimeout(() => {
        if (peerRef.current && peerRef.current.connectionState !== 'connected') {
          nextRef.current();
        }
      }, MATCH_TIMEOUT_MS);

      roomIdRef.current = p.roomId;
      isInitiatorRef.current = p.isInitiator;
      dispatch({ type: 'MATCHED', roomId: p.roomId, peer: p.peer });
      track('match_started');
      void beginNegotiation(p);
    };

    const onOffer = async (p: RtcOfferPayload) => {
      const manager = peerRef.current;
      if (!manager || manager.isClosed || p.roomId !== roomIdRef.current) return;
      // A SECOND offer on an already-connected peer is an ICE-restart
      // renegotiation initiated by the other side. Reflect the reconnecting UI
      // on this (answerer) side too so both peers show the same state. The
      // existing setRemoteDescription/createAnswer path handles re-offers; the
      // browser performs an implicit rollback if we were mid-negotiation.
      if (
        manager.connectionState === 'connected' ||
        manager.iceConnectionState === 'disconnected' ||
        manager.iceConnectionState === 'failed'
      ) {
        if (!reconnectingRef.current) {
          reconnectingRef.current = true;
          dispatch({ type: 'RECONNECTING', attempt: 1 });
        }
      }
      try {
        await manager.setRemoteDescription('offer', p.sdp);
        const sdp = await manager.createAnswer();
        if (roomIdRef.current && !manager.isClosed) {
          socket.emit('rtc:answer', { roomId: roomIdRef.current, sdp });
        }
      } catch {
        /* renegotiation can race teardown; the watchdog/peer-gone path covers it */
      }
    };

    const onAnswer = async (p: RtcOfferPayload) => {
      const manager = peerRef.current;
      if (!manager || manager.isClosed || p.roomId !== roomIdRef.current) return;
      try {
        // setRemoteDescription guards against a stale answer (wrong signaling
        // state) internally, so a late/duplicate answer can't break the call.
        await manager.setRemoteDescription('answer', p.sdp);
      } catch {
        /* ignore — a benign renegotiation/teardown race */
      }
    };

    const onIce = async (p: RtcIcePayload) => {
      const manager = peerRef.current;
      if (!manager || p.roomId !== roomIdRef.current) return;
      if (p.candidate) {
        await manager.addIceCandidate(p.candidate as RTCIceCandidateInit);
      }
    };

    const onHangup = () => {
      handlePeerGoneRef.current();
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('mm:waiting', onWaiting);
    socket.on('mm:matched', onMatched);
    socket.on('rtc:offer', onOffer);
    socket.on('rtc:answer', onAnswer);
    socket.on('rtc:ice-candidate', onIce);
    socket.on('rtc:hangup', onHangup);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('mm:waiting', onWaiting);
      socket.off('mm:matched', onMatched);
      socket.off('rtc:offer', onOffer);
      socket.off('rtc:answer', onAnswer);
      socket.off('rtc:ice-candidate', onIce);
      socket.off('rtc:hangup', onHangup);
    };
  }, [type, beginNegotiation, clearMatchTimeout, clearRequeueTimeout]);

  // ───────────────────────────── Actions ───────────────────────────────
  // Acquire (or reuse) the local stream. Coalesces concurrent callers onto one
  // getUserMedia promise so prewarm + start can't open two camera streams. A
  // live stream (e.g. from a successful prewarm) is reused as-is.
  const acquireLocalStream = useCallback(async (): Promise<MediaStream> => {
    const existing = localStreamRef.current;
    // Reuse only if the stream still has live tracks (a stopped stream from a
    // prior session must be re-acquired).
    if (existing && existing.getTracks().some((t) => t.readyState === 'live')) {
      return existing;
    }
    if (acquiringRef.current) return acquiringRef.current;
    const p = getLocalStream(isVideo);
    acquiringRef.current = p;
    try {
      const stream = await p;
      localStreamRef.current = stream;
      dispatch({ type: 'LOCAL_STREAM', stream });
      dispatch({ type: 'MIC', muted: false });
      dispatch({ type: 'CAMERA', off: false });
      return stream;
    } finally {
      acquiringRef.current = null;
    }
  }, [isVideo]);

  // Pre-acquire camera/mic + ICE servers BEFORE the user hits Start, so the
  // connect path is instant at click time. Best-effort and fully silent: any
  // failure (e.g. permission not yet granted) is swallowed — start() will
  // surface the real, actionable error when the user explicitly opts in.
  // No-op once a session is active or media is already live.
  const prewarm = useCallback(() => {
    if (startedRef.current || !token) return;
    if (localStreamRef.current || acquiringRef.current) {
      void ensureIceServers();
      return;
    }
    void acquireLocalStream().catch(() => {
      /* swallow — start() will re-attempt and report a real error */
    });
    void ensureIceServers();
  }, [token, acquireLocalStream, ensureIceServers]);

  const start = useCallback(async () => {
    if (startedRef.current || isStarting) return;
    if (!token) {
      dispatch({
        type: 'ERROR',
        error: { kind: 'socket', message: t('errors.signInToStart') },
      });
      return;
    }

    setIsStarting(true);
    dispatch({ type: 'REQUESTING' });
    try {
      // 1) Local media — reuses a pre-warmed stream when available (instant),
      //    otherwise acquires now. Fails fast on permission/device problems.
      await acquireLocalStream();

      // 2) ICE servers (best-effort; STUN fallback otherwise). Usually already
      //    resolved by prewarm(), so this is a no-op await.
      await ensureIceServers();

      // 3) Connect socket with the auth token. The `connect` handler emits the
      //    initial `mm:join` (and handles reconnect re-join), so the queue join
      //    is driven off a single place. Show "searching" immediately for UX.
      startedRef.current = true;
      dispatch({ type: 'SEARCHING' });
      clearMatchTimeout();
      matchTimeoutRef.current = setTimeout(() => {
        dispatch({ type: 'WAITING', positionHint: null });
      }, MATCH_TIMEOUT_MS);
      connectSocket(token);
      // If the socket was already connected (e.g. quick stop→start), `connect`
      // won't refire — emit the join directly in that case.
      const socket = getSocket('/mm');
      if (socket.connected && !peerRef.current && !roomIdRef.current) {
        joinedRef.current = true;
        socket.emit('mm:join', { type, filters: filtersRef.current });
      }
    } catch (err) {
      startedRef.current = false;
      if (err instanceof MediaError) {
        dispatch({
          type: 'ERROR',
          error: { kind: err.kind, message: t(`mediaError.${err.kind}`) },
        });
      } else {
        dispatch({
          type: 'ERROR',
          error: { kind: 'unknown', message: t('errors.startFailed') },
        });
      }
    } finally {
      setIsStarting(false);
    }
  }, [token, isStarting, acquireLocalStream, ensureIceServers, clearMatchTimeout, type, t]);

  const next = useCallback(() => {
    if (!startedRef.current) return;
    track('match_skipped');
    const socket = getSocket('/mm');
    clearRequeueTimeout();
    // Proactively hang up so the peer tears down instantly (the server also
    // notifies them as part of handling `mm:next`).
    if (roomIdRef.current) {
      socket.emit('rtc:hangup', { roomId: roomIdRef.current, reason: 'next' });
    }
    // `mm:next` tears down our current room AND re-queues us with the same
    // type/filters (server-remembered) — so we do NOT emit `mm:join` here.
    socket.emit('mm:next');
    // Tear down the local peer and reflect "searching" while we wait for the
    // next `mm:matched` (or `mm:waiting`).
    closePeer();
    dispatch({ type: 'SEARCHING' });
    clearMatchTimeout();
    matchTimeoutRef.current = setTimeout(() => {
      dispatch({ type: 'WAITING', positionHint: null });
    }, MATCH_TIMEOUT_MS);
  }, [closePeer, clearRequeueTimeout, clearMatchTimeout]);
  useEffect(() => {
    nextRef.current = next;
  }, [next]);

  const stop = useCallback(() => {
    const socket = getSocket('/mm');
    if (roomIdRef.current) {
      socket.emit('rtc:hangup', { roomId: roomIdRef.current, reason: 'stop' });
    }
    startedRef.current = false;
    joinedRef.current = false;
    clearMatchTimeout();
    clearRequeueTimeout();
    socket.emit('mm:leave');
    closePeer(); // also clears reconnect/quality timers
    stopStream(localStreamRef.current);
    localStreamRef.current = null;
    // If a prewarm getUserMedia is still resolving, stop its tracks on arrival
    // so we never leave a camera light on after the user stopped.
    if (acquiringRef.current) {
      const pending = acquiringRef.current;
      acquiringRef.current = null;
      void pending.then(stopStream).catch(() => undefined);
    }
    iceServersRef.current = null;
    // Do NOT disconnect the shared /mm socket here: its lifecycle is owned by
    // login/logout, and notifications (`notif:new`) + the /chat socket ride on
    // it app-wide. Leaving the roulette session only means exiting the queue/
    // match — `mm:leave` (emitted above) does that server-side, and this hook's
    // socket listeners are torn down by the wiring effect's cleanup on unmount.
    // The connection stays live so the bell and chat keep working.
    dispatch({ type: 'RESET' });
  }, [closePeer, clearMatchTimeout, clearRequeueTimeout]);

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const audio = stream.getAudioTracks();
    const first = audio[0];
    if (!first) return;
    // If the first track is currently enabled we're about to mute.
    const willMute = first.enabled;
    audio.forEach((t) => (t.enabled = !willMute));
    dispatch({ type: 'MIC', muted: willMute });
  }, []);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const video = stream.getVideoTracks();
    const first = video[0];
    if (!first) return;
    const nextOff = first.enabled; // currently on → turning off
    video.forEach((t) => (t.enabled = !nextOff));
    dispatch({ type: 'CAMERA', off: nextOff });
  }, []);

  const sendChatMessage = useCallback((text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    const ok = peerRef.current?.sendChatMessage(trimmed) ?? false;
    if (ok) {
      dispatch({
        type: 'CHAT_ADD',
        line: { id: crypto.randomUUID(), from: 'me', text: trimmed, at: Date.now() },
      });
    }
    return ok;
  }, []);

  const setChatOpen = useCallback((open: boolean) => {
    dispatch({ type: 'CHAT_OPEN', open });
  }, []);

  // ── Unmount cleanup: never leak a camera light or socket room ──
  useEffect(() => {
    return () => {
      startedRef.current = false;
      joinedRef.current = false;
      if (matchTimeoutRef.current) clearTimeout(matchTimeoutRef.current);
      if (requeueTimeoutRef.current) clearTimeout(requeueTimeoutRef.current);
      if (iceGraceTimerRef.current) clearTimeout(iceGraceTimerRef.current);
      if (iceRestartTimeoutRef.current) clearTimeout(iceRestartTimeoutRef.current);
      if (qualityTimerRef.current) clearInterval(qualityTimerRef.current);
      const socket = getSocket('/mm');
      try {
        if (roomIdRef.current) {
          socket.emit('rtc:hangup', { roomId: roomIdRef.current, reason: 'stop' });
        }
        socket.emit('mm:leave');
      } catch {
        /* socket may already be down */
      }
      peerRef.current?.close();
      peerRef.current = null;
      stopStream(localStreamRef.current);
      localStreamRef.current = null;
      // Stop a still-resolving prewarm stream so its tracks never linger.
      if (acquiringRef.current) {
        void acquiringRef.current.then(stopStream).catch(() => undefined);
        acquiringRef.current = null;
      }
      // Do NOT disconnect the shared /mm socket on unmount: it's owned by
      // login/logout and shared app-wide (notifications + chat). We only leave
      // the queue/match (`mm:leave` above); this hook's socket listeners are
      // removed by the wiring effect's own cleanup, so nothing leaks.
    };
  }, []);

  return {
    ...state,
    filters,
    setFilters,
    prewarm,
    start,
    next,
    stop,
    toggleMic,
    toggleCamera,
    sendChatMessage,
    setChatOpen,
    isStarting,
  };
}
