/**
 * WebRTC helpers for ruletka.top — owned by the roulette feature.
 *
 * This module is intentionally framework-agnostic (no React): it wraps the raw
 * browser APIs (`getUserMedia`, `RTCPeerConnection`) behind small, testable
 * helpers so the `useRoulette` hook can stay focused on orchestration and the
 * socket signaling contract.
 *
 * Signaling itself is owned by the caller — this module never touches the
 * socket. The caller wires the manager's callbacks (`onIceCandidate`,
 * `onTrack`, `onConnectionStateChange`) to the typed `rtc:*` events and feeds
 * remote SDP / ICE back in via `setRemoteDescription` / `addIceCandidate`.
 */

// ───────────────────────────── ICE config ─────────────────────────────
/**
 * One ICE server entry, matching the browser's
 * `RTCPeerConnection({ iceServers })` shape. Mirrors the `/turn/credentials`
 * response body from the API (which is not exported from the shared contract).
 */
export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Body returned by `GET /turn/credentials`. */
export interface TurnCredentials {
  iceServers: IceServerConfig[];
  /** Unix epoch (seconds) at which the TURN credential stops being valid. */
  ttlExpiresAt: number;
}

/**
 * A safe default ICE configuration (public STUN only). Used as a fallback when
 * `/turn/credentials` is unreachable so a same-network / non-NAT call can still
 * connect during local development.
 */
export const FALLBACK_ICE_SERVERS: IceServerConfig[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

// ─────────────────────────── Media helpers ────────────────────────────
/** Distinct, user-actionable failure modes when acquiring local media. */
export type MediaErrorKind =
  | 'denied' // user/OS blocked the permission
  | 'notfound' // no camera/mic hardware
  | 'inuse' // device busy in another app
  | 'insecure' // not a secure context (getUserMedia unavailable)
  | 'unknown';

export class MediaError extends Error {
  readonly kind: MediaErrorKind;
  constructor(kind: MediaErrorKind, message: string) {
    super(message);
    this.name = 'MediaError';
    this.kind = kind;
  }
}

/** Maps a DOMException from getUserMedia onto our coarse {@link MediaErrorKind}. */
function classifyMediaError(err: unknown): MediaErrorKind {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'denied';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'notfound';
      case 'NotReadableError':
      case 'AbortError':
        return 'inuse';
      default:
        return 'unknown';
    }
  }
  return 'unknown';
}

/**
 * Acquire a local {@link MediaStream}. `video` requests a sensible 720p ideal
 * (front camera on mobile); audio is always requested with echo cancellation +
 * noise suppression for a clean call.
 *
 * Throws a {@link MediaError} with a coarse `kind` the UI can branch on.
 */
export async function getLocalStream(video: boolean): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new MediaError('insecure', 'Camera and microphone are unavailable.');
  }

  const constraints: MediaStreamConstraints = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: video
      ? {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
          frameRate: { ideal: 30, max: 60 },
        }
      : false,
  };

  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    const kind = classifyMediaError(err);
    // The UI maps `kind` → a localized message (roulette.mediaError.*); this
    // string is only a dev/non-UI fallback, so it stays in plain English.
    const message =
      kind === 'denied'
        ? 'Access to camera/microphone was denied.'
        : kind === 'notfound'
          ? 'Camera or microphone not found.'
          : kind === 'inuse'
            ? 'A media device is in use by another application.'
            : 'Could not access media devices.';
    throw new MediaError(kind, message);
  }
}

/** Stop every track on a stream (idempotent, null-safe). */
export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      /* already stopped */
    }
  });
}

// ───────────────────────── Connection quality ─────────────────────────
/**
 * A coarse, user-facing call-quality bucket derived from {@link PeerConnectionManager.sampleQuality}.
 *
 *  great — pristine link (low RTT, ~no loss, low jitter)
 *  good  — perfectly usable, minor imperfections
 *  poor  — noticeably degraded (stutter / lag likely)
 *  bad   — barely usable; a reconnect may be imminent
 *
 * `null` means "not enough data yet" (just connected, or stats unavailable).
 */
export type QualityLevel = 'great' | 'good' | 'poor' | 'bad';

/** A single quality sample plus the raw metrics it was derived from. */
export interface QualitySample {
  level: QualityLevel;
  /** Round-trip time of the selected candidate pair, in milliseconds (or null). */
  rttMs: number | null;
  /** Fraction of inbound RTP packets lost since the last sample, 0..1 (or null). */
  loss: number | null;
  /** Inbound jitter in milliseconds (or null). */
  jitterMs: number | null;
}

/**
 * Map raw transport metrics onto a {@link QualityLevel}. Tuned for real-time
 * video/voice: thresholds roughly track perceived MOS bands. We take the WORST
 * of the available signals (one bad dimension is enough to degrade the call),
 * and ignore dimensions that are `null` (not yet measured). With no signal at
 * all we optimistically report 'good' — the link is up (we only sample while
 * connected), we just lack telemetry to grade it precisely.
 */
export function scoreQuality(m: {
  rttMs: number | null;
  loss: number | null;
  jitterMs: number | null;
}): QualityLevel {
  const ranks: number[] = []; // 0=great … 3=bad
  if (m.rttMs != null) {
    ranks.push(m.rttMs < 150 ? 0 : m.rttMs < 300 ? 1 : m.rttMs < 500 ? 2 : 3);
  }
  if (m.loss != null) {
    ranks.push(m.loss < 0.02 ? 0 : m.loss < 0.05 ? 1 : m.loss < 0.1 ? 2 : 3);
  }
  if (m.jitterMs != null) {
    ranks.push(m.jitterMs < 30 ? 0 : m.jitterMs < 50 ? 1 : m.jitterMs < 100 ? 2 : 3);
  }
  if (ranks.length === 0) return 'good';
  const levels = ['great', 'good', 'poor', 'bad'] as const;
  const worst = Math.max(...ranks);
  // `worst` is always 0–3, but the index signature is non-narrowing under
  // noUncheckedIndexedAccess — coalesce to satisfy the QualityLevel return type.
  return levels[worst] ?? 'bad';
}

// ──────────────────────── Peer connection manager ─────────────────────
export interface PeerManagerCallbacks {
  /** A local ICE candidate was gathered — forward it over signaling. */
  onIceCandidate: (candidate: RTCIceCandidateInit) => void;
  /** A remote media track arrived — attach its stream to a media element. */
  onTrack: (stream: MediaStream) => void;
  /** The aggregate connection state changed (drives the UI status). */
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
  /**
   * The ICE transport state changed. Distinct from {@link onConnectionStateChange}:
   * `iceConnectionState` surfaces the transient 'disconnected' → 'failed' path
   * that drives our grace-timer + ICE-restart recovery, where the aggregate
   * `connectionState` can be slower / coarser across browsers.
   */
  onIceConnectionStateChange?: (state: RTCIceConnectionState) => void;
  /**
   * A text message arrived over the peer-to-peer data channel (in-call chat).
   * Optional: only wired when in-call chat is enabled.
   */
  onDataMessage?: (text: string) => void;
  /** The data channel opened/closed (drives chat availability). */
  onDataChannelState?: (open: boolean) => void;
}

/** Label for the in-call chat data channel. */
const CHAT_CHANNEL_LABEL = 'ruletka-chat';

/**
 * Thin wrapper around a single {@link RTCPeerConnection} that:
 *  - adds local tracks,
 *  - emits gathered ICE candidates via a callback,
 *  - surfaces the first remote stream,
 *  - **queues remote ICE candidates** received before `setRemoteDescription`
 *    has been applied (a classic glare/race pitfall), flushing them after.
 *
 * One manager instance maps to one call; create a fresh one per match and
 * `close()` it on hangup/next/stop.
 */
export class PeerConnectionManager {
  private pc: RTCPeerConnection;
  private readonly callbacks: PeerManagerCallbacks;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private hasRemoteDescription = false;
  private closed = false;
  private remoteStream: MediaStream | null = null;
  private chatChannel: RTCDataChannel | null = null;
  /** Per-stream cumulative counters from the previous {@link sampleQuality} call. */
  private lastStats: {
    packetsLost: number;
    packetsReceived: number;
    at: number;
  } | null = null;

  constructor(
    iceServers: IceServerConfig[],
    callbacks: PeerManagerCallbacks,
    options: { isInitiator?: boolean; withChat?: boolean } = {},
  ) {
    this.callbacks = callbacks;
    this.pc = new RTCPeerConnection({
      iceServers: iceServers as RTCIceServer[],
      // Bundle + rtcp-mux keep the connection to a single transport.
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
    this.wire();

    if (options.withChat) {
      if (options.isInitiator) {
        // The initiator creates the channel; it must exist BEFORE createOffer
        // so the SDP advertises it.
        this.attachChatChannel(this.pc.createDataChannel(CHAT_CHANNEL_LABEL, { ordered: true }));
      } else {
        // The answerer receives it via ondatachannel.
        this.pc.ondatachannel = (event) => {
          if (event.channel.label === CHAT_CHANNEL_LABEL) {
            this.attachChatChannel(event.channel);
          }
        };
      }
    }
  }

  private attachChatChannel(channel: RTCDataChannel): void {
    this.chatChannel = channel;
    channel.onopen = () => this.callbacks.onDataChannelState?.(true);
    channel.onclose = () => this.callbacks.onDataChannelState?.(false);
    channel.onmessage = (event) => {
      if (typeof event.data === 'string') this.callbacks.onDataMessage?.(event.data);
    };
  }

  private wire(): void {
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.callbacks.onIceCandidate(event.candidate.toJSON());
      }
    };

    this.pc.ontrack = (event) => {
      // Prefer the stream the browser groups tracks into; fall back to a
      // synthesised stream so audio-only calls still surface a MediaStream.
      const stream = event.streams[0] ?? this.ensureRemoteStream(event.track);
      this.remoteStream = stream;
      this.callbacks.onTrack(stream);
    };

    this.pc.onconnectionstatechange = () => {
      if (this.closed) return;
      this.callbacks.onConnectionStateChange(this.pc.connectionState);
    };

    this.pc.oniceconnectionstatechange = () => {
      if (this.closed) return;
      this.callbacks.onIceConnectionStateChange?.(this.pc.iceConnectionState);
    };
  }

  /** Send a text message over the in-call data channel. No-op if not open. */
  sendChatMessage(text: string): boolean {
    if (this.chatChannel?.readyState === 'open') {
      try {
        this.chatChannel.send(text);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  private ensureRemoteStream(track: MediaStreamTrack): MediaStream {
    if (!this.remoteStream) this.remoteStream = new MediaStream();
    this.remoteStream.addTrack(track);
    return this.remoteStream;
  }

  /** Add every track of the local stream to the connection. */
  addLocalStream(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      this.pc.addTrack(track, stream);
    }
  }

  /**
   * Create an SDP offer, set it as local description, and return the SDP.
   *
   * Pass `{ iceRestart: true }` to renegotiate with fresh ICE credentials — the
   * recovery path when a live call's transport goes to 'failed'. The resulting
   * offer is sent over the SAME `rtc:offer` signaling channel as the first one;
   * the peer handles it as an ordinary renegotiation offer.
   */
  async createOffer(options: { iceRestart?: boolean } = {}): Promise<string> {
    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
      iceRestart: options.iceRestart ?? false,
    });
    await this.pc.setLocalDescription(offer);
    if (options.iceRestart) this.lastStats = null; // counters may reset
    return offer.sdp ?? '';
  }

  /** Create an SDP answer (after a remote offer), set it locally, return SDP. */
  async createAnswer(): Promise<string> {
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer.sdp ?? '';
  }

  /**
   * Apply a remote SDP description (offer or answer). Once applied, any ICE
   * candidates that arrived early are flushed in order.
   *
   * Safe for renegotiation (ICE restart): a remote OFFER is accepted in both
   * `stable` (fresh negotiation) and `have-remote-offer` (re-offer) states; the
   * browser performs an implicit rollback if needed. A remote ANSWER is only
   * meaningful while we have a local offer outstanding (`have-local-offer`); an
   * answer that arrives in any other state is stale/duplicate and is ignored so
   * a late answer can't tear down an otherwise-healthy call.
   */
  async setRemoteDescription(type: 'offer' | 'answer', sdp: string): Promise<void> {
    if (type === 'answer' && this.pc.signalingState !== 'have-local-offer') {
      // No pending local offer → this answer is stale (e.g. raced a restart).
      return;
    }
    await this.pc.setRemoteDescription({ type, sdp });
    this.hasRemoteDescription = true;
    await this.flushPendingCandidates();
  }

  /**
   * Add a remote ICE candidate. If the remote description isn't set yet, the
   * candidate is queued and applied later by {@link flushPendingCandidates}.
   */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.hasRemoteDescription) {
      this.pendingCandidates.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
    } catch {
      /* benign: candidate can race a renegotiation/close */
    }
  }

  private async flushPendingCandidates(): Promise<void> {
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of queued) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch {
        /* ignore individual failures */
      }
    }
  }

  /** Current aggregate connection state. */
  get connectionState(): RTCPeerConnectionState {
    return this.pc.connectionState;
  }

  /** Current ICE transport state (drives reconnection heuristics). */
  get iceConnectionState(): RTCIceConnectionState {
    return this.pc.iceConnectionState;
  }

  /** Whether the underlying connection has been closed/torn down. */
  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Ask the ICE agent to gather fresh candidates without producing an offer.
   * On browsers that support {@link RTCPeerConnection.restartIce} this flags the
   * next negotiation for a restart; the caller then drives the offer/answer via
   * {@link createOffer} (the `negotiationneeded`-free, manual signaling path we
   * already use). Returns `true` if the native API was invoked.
   *
   * No-op safe: if `restartIce` is unavailable the caller falls back to
   * `createOffer({ iceRestart: true })`, which restarts ICE on its own.
   */
  restartIce(): boolean {
    if (this.closed) return false;
    const fn = (this.pc as RTCPeerConnection & { restartIce?: () => void }).restartIce;
    if (typeof fn === 'function') {
      try {
        fn.call(this.pc);
        // Counters may reset after a restart — drop the baseline so the next
        // sample re-establishes it instead of reporting a bogus negative delta.
        this.lastStats = null;
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Sample current call quality from `getStats()` and bucket it into a coarse
   * {@link QualityLevel}. Degrades gracefully: returns `level: null`-equivalent
   * via a 'good' floor only when *some* signal exists, and surfaces `null`
   * metrics + a best-effort level when stats are unavailable (old browsers,
   * teardown races). Never throws.
   *
   * Packet loss is computed as a delta against the previous sample (the
   * underlying counters are cumulative), so the FIRST call after connect — or
   * after a restart that resets counters — reports `loss: null` and leans on
   * RTT/jitter only.
   */
  async sampleQuality(): Promise<QualitySample | null> {
    if (this.closed) return null;
    let report: RTCStatsReport;
    try {
      report = await this.pc.getStats();
    } catch {
      return null;
    }
    if (this.closed) return null;

    let rttMs: number | null = null;
    let jitterMs: number | null = null;
    let packetsLost: number | null = null;
    let packetsReceived: number | null = null;

    // ── Selected candidate pair → RTT ──
    // Prefer the transport's explicitly selected pair; otherwise fall back to a
    // nominated/succeeded pair. Browsers differ on which they populate.
    let selectedPairId: string | undefined;
    report.forEach((stat) => {
      if (stat.type === 'transport') {
        const t = stat as RTCStats & { selectedCandidatePairId?: string };
        if (t.selectedCandidatePairId) selectedPairId = t.selectedCandidatePairId;
      }
    });
    report.forEach((stat) => {
      if (stat.type !== 'candidate-pair') return;
      const pair = stat as RTCStats & {
        nominated?: boolean;
        state?: string;
        selected?: boolean;
        currentRoundTripTime?: number;
      };
      const isSelected =
        (selectedPairId != null && stat.id === selectedPairId) ||
        pair.selected === true ||
        (pair.nominated === true && pair.state === 'succeeded');
      if (isSelected && typeof pair.currentRoundTripTime === 'number') {
        rttMs = pair.currentRoundTripTime * 1000;
      }
    });

    // ── Inbound RTP → loss + jitter (aggregate across audio+video) ──
    let lostAccum = 0;
    let recvAccum = 0;
    let jitterSecMax = 0;
    let sawInbound = false;
    report.forEach((stat) => {
      if (stat.type !== 'inbound-rtp') return;
      const rtp = stat as RTCStats & {
        packetsLost?: number;
        packetsReceived?: number;
        jitter?: number;
      };
      sawInbound = true;
      if (typeof rtp.packetsLost === 'number') lostAccum += Math.max(0, rtp.packetsLost);
      if (typeof rtp.packetsReceived === 'number') recvAccum += rtp.packetsReceived;
      // jitter is reported in SECONDS; keep the worst stream as the headline.
      if (typeof rtp.jitter === 'number') jitterSecMax = Math.max(jitterSecMax, rtp.jitter);
    });
    if (sawInbound) {
      packetsLost = lostAccum;
      packetsReceived = recvAccum;
      jitterMs = jitterSecMax * 1000;
    }

    // ── Delta loss-rate vs. previous sample ──
    let loss: number | null = null;
    if (packetsLost != null && packetsReceived != null) {
      const prev = this.lastStats;
      if (prev) {
        const dLost = packetsLost - prev.packetsLost;
        const dRecv = packetsReceived - prev.packetsReceived;
        const denom = dLost + dRecv;
        // Guard against counter resets (negative deltas) after a restart.
        if (denom > 0 && dLost >= 0 && dRecv >= 0) {
          loss = dLost / denom;
        } else if (denom <= 0) {
          loss = 0; // no traffic in the window → treat as no loss
        }
      }
      this.lastStats = { packetsLost, packetsReceived, at: Date.now() };
    }

    return { level: scoreQuality({ rttMs, loss, jitterMs }), rttMs, loss, jitterMs };
  }

  /** Tear down the connection and detach all handlers. Idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.pendingCandidates = [];
    this.lastStats = null;
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    this.pc.oniceconnectionstatechange = null;
    this.pc.ondatachannel = null;
    if (this.chatChannel) {
      this.chatChannel.onopen = null;
      this.chatChannel.onclose = null;
      this.chatChannel.onmessage = null;
      try {
        this.chatChannel.close();
      } catch {
        /* noop */
      }
      this.chatChannel = null;
    }
    try {
      this.pc.getSenders().forEach((sender) => {
        try {
          this.pc.removeTrack(sender);
        } catch {
          /* noop */
        }
      });
      this.pc.close();
    } catch {
      /* already closed */
    }
    this.remoteStream = null;
  }
}
