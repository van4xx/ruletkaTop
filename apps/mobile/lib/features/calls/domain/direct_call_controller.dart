import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/di.dart';
import '../../../core/models/models.dart';
import '../../../core/socket/socket.dart';

/// How long an incoming/outgoing ring stays live before it auto-cancels, so a
/// missed call never hangs forever (mirrors the web `AUTO_DECLINE_MS`).
const Duration kDirectCallRingTimeout = Duration(seconds: 30);

/// Which side of a pending direct (friend) call we are on.
enum DirectCallDirection {
  /// We pressed "call" on a friend and are ringing them (caller).
  outgoing,

  /// A friend is ringing us; we have not answered yet (callee).
  incoming,
}

/// A pending direct (friend) call awaiting an answer, surfaced by the global
/// [DirectCallHost]. Mirrors the web's incoming `CallInviteModal` + the caller's
/// "ringing" treatment, both driven off the `call:*` events on the `/mm` socket.
@immutable
class DirectCallRing {
  const DirectCallRing({
    required this.direction,
    required this.peerUserId,
    required this.type,
    this.callId,
  });

  final DirectCallDirection direction;

  /// The other party — the invitee (outgoing) or the caller (incoming).
  final String peerUserId;

  final MatchType type;

  /// The server-minted call id. Present immediately for an INCOMING invite; for
  /// an OUTGOING call it is unknown until the callee accepts (`call:accept`).
  final String? callId;

  bool get isIncoming => direction == DirectCallDirection.incoming;
  bool get isOutgoing => direction == DirectCallDirection.outgoing;

  DirectCallRing copyWith({String? callId}) => DirectCallRing(
        direction: direction,
        peerUserId: peerUserId,
        type: type,
        callId: callId ?? this.callId,
      );
}

/// Who we are in the direct call we're about to launch onto the roulette stage.
enum DirectCallLaunchRole {
  /// We placed the call (rang the callee); we drive the WebRTC offer.
  caller,

  /// We answered an incoming call; we answer the caller's offer.
  callee,
}

/// A one-shot signal that an accepted direct call should now open its stage,
/// consumed once by the [DirectCallHost] to hand the call off to the roulette
/// engine. Carries the modality (so the host routes to `/video` or `/voice`),
/// our [role] (so the engine knows whether to offer or answer) and the
/// server-minted [callId] that scopes the `call:<callId>` signaling room.
///
/// By the time a launch is produced the call is ALREADY accepted server-side
/// (both the caller's and callee's paths only launch post-accept), so [callId]
/// is always present.
@immutable
class DirectCallLaunch {
  const DirectCallLaunch({
    required this.type,
    required this.peerUserId,
    required this.role,
    required this.callId,
  });

  final MatchType type;
  final String peerUserId;
  final DirectCallLaunchRole role;
  final String callId;
}

/// Immutable view-state for the global direct-call host: the active ring (if
/// any), a pending launch to navigate to, and a transient toast message
/// (e.g. "отклонил вызов").
@immutable
class DirectCallState {
  const DirectCallState({this.ring, this.launch, this.toast});

  final DirectCallRing? ring;
  final DirectCallLaunch? launch;
  final String? toast;

  bool get hasRing => ring != null;

  DirectCallState copyWith({
    DirectCallRing? ring,
    DirectCallLaunch? launch,
    String? toast,
    bool clearRing = false,
    bool clearLaunch = false,
    bool clearToast = false,
  }) =>
      DirectCallState(
        ring: clearRing ? null : (ring ?? this.ring),
        launch: clearLaunch ? null : (launch ?? this.launch),
        toast: clearToast ? null : (toast ?? this.toast),
      );
}

/// Owns the GLOBAL direct-call (friend call) lifecycle — the native twin of the
/// web `ModalHost` incoming-call listener + the caller-side `call:*` wiring in
/// `useRoulette`.
///
/// Subscribes ONCE to the `call:*` events on the always-alive `/mm` socket:
///   * `call:invite`  (callee) → ring the incoming-call sheet.
///   * `call:accept`  (caller) → the callee answered; launch the call stage.
///   * `call:decline` (caller) → the callee rejected; toast + clear the ring.
///   * `call:end`     (both)   → the call/ring ended; clear any active ring.
///
/// Outgoing calls are started via [placeCall] (from a friend card); the answer
/// arrives on `call:accept`. Incoming calls are answered with [accept] (emits
/// `call:accept` and launches the stage) or rejected with [decline] (emits
/// `call:decline`). A ring that goes unanswered auto-cancels after
/// [kDirectCallRingTimeout].
///
/// NOTE: this is the SIGNALING + UX layer. Establishing the WebRTC media for an
/// accepted direct call is the roulette engine's responsibility (it runs the
/// `call:<id>` room over the same `rtc:*` contract); the host hands off by
/// navigating to the stage with the peer.
class DirectCallController extends Notifier<DirectCallState> {
  SocketService get _socket => ref.read(socketServiceProvider);
  String? get _selfId => ref.read(currentUserIdProvider);

  final List<VoidCallback> _subs = [];
  Timer? _ringTimeout;

  @override
  DirectCallState build() {
    // Wire the global call listeners once and tear them down on dispose.
    _subs.addAll([
      _socket.onIncomingCall(_onIncoming),
      _socket.onCallAccept(_onAccepted),
      _socket.onCallDecline(_onDeclined),
      _socket.onCallEnd(_onEnded),
    ]);
    ref.onDispose(() {
      _ringTimeout?.cancel();
      for (final off in _subs) {
        off();
      }
      _subs.clear();
    });
    return const DirectCallState();
  }

  // ─────────────────────────── Incoming (callee) ──────────────────────────
  void _onIncoming(IncomingCall call) {
    // Ignore an echo of our own invite (defensive) and don't let a second
    // invite stomp an in-progress ring.
    if (call.fromUserId.isEmpty || call.fromUserId == _selfId) return;
    if (state.ring != null) {
      // Already ringing someone — auto-decline the newcomer so the server frees
      // the call slot, and keep the current ring.
      _socket.callDecline(call.callId);
      return;
    }
    _armRingTimeout();
    state = state.copyWith(
      ring: DirectCallRing(
        direction: DirectCallDirection.incoming,
        peerUserId: call.fromUserId,
        type: call.type,
        callId: call.callId,
      ),
    );
  }

  // ─────────────────────────── Outgoing (caller) ──────────────────────────
  /// Place a direct call to [peerUserId] with [type]: emit `call:invite` and
  /// ring locally until the callee accepts/declines (or the ring times out).
  void placeCall(String peerUserId, MatchType type) {
    if (state.ring != null) return; // one ring at a time
    _socket.callInvite(peerUserId, type);
    _armRingTimeout();
    state = state.copyWith(
      ring: DirectCallRing(
        direction: DirectCallDirection.outgoing,
        peerUserId: peerUserId,
        type: type,
      ),
    );
  }

  /// The callee answered our outgoing invite — launch the call stage as the
  /// CALLER (the roulette engine drives the offer over the `call:<callId>`
  /// room). The server relayed the minted `callId` with the accept, which the
  /// launch carries so the engine can scope its signaling AND so a later cancel
  /// can be routed by it (`call:end { callId }`).
  void _onAccepted(CallResponsePayload p) {
    final ring = state.ring;
    if (ring == null || ring.isIncoming) return;
    _clearRingTimeout();
    state = state.copyWith(
      clearRing: true,
      launch: DirectCallLaunch(
        type: ring.type,
        peerUserId: ring.peerUserId,
        role: DirectCallLaunchRole.caller,
        callId: p.callId,
      ),
    );
  }

  /// The callee rejected our outgoing invite — surface a toast + clear the ring.
  void _onDeclined(CallResponsePayload p) {
    final ring = state.ring;
    if (ring == null || ring.isIncoming) return;
    _clearRingTimeout();
    state = state.copyWith(clearRing: true, toast: 'Вызов отклонён');
  }

  /// Either party ended an (accepted) call, OR our outgoing invite was
  /// cancelled / rang out server-side. Clear any active ring.
  void _onEnded(CallResponsePayload p) {
    if (state.ring == null) return;
    _clearRingTimeout();
    state = state.copyWith(clearRing: true);
  }

  // ───────────────────────────── User actions ─────────────────────────────
  /// Accept the incoming call: launch the matching stage as the CALLEE.
  ///
  /// We DELIBERATELY do NOT emit `call:accept` here. The roulette engine emits it
  /// only AFTER it has built the answerer peer connection (see
  /// `RouletteController.startDirectCall`), which closes a race: the server tells
  /// the caller to offer the instant we accept, and that offer must not arrive on
  /// our socket before our `rtc:offer` handler + PC exist. We can't accept
  /// without the [callId] the invite carried, so bail (the ring will time out)
  /// if it's somehow missing.
  void accept() {
    final ring = state.ring;
    if (ring == null || ring.isOutgoing) return;
    final callId = ring.callId;
    if (callId == null) return; // an incoming invite always carries a callId
    _clearRingTimeout();
    state = state.copyWith(
      clearRing: true,
      launch: DirectCallLaunch(
        type: ring.type,
        peerUserId: ring.peerUserId,
        role: DirectCallLaunchRole.callee,
        callId: callId,
      ),
    );
  }

  /// Decline the incoming call (or cancel our own outgoing ring): notify the
  /// server so the OTHER party's ring resolves, then clear our ring.
  ///
  ///  * Incoming (callee) → `call:decline { callId }` (we always hold the
  ///    callId), so the caller's "вызов…" UI resolves immediately.
  ///  * Outgoing (caller) → `call:end { callId }` to cancel the ringing invite
  ///    server-side so the callee stops ringing at once. The server mints the
  ///    callId and only relays it to the caller on `call:accept`, so pre-accept
  ///    we genuinely have no id to route by — the server's ring TTL resolves the
  ///    callee in that window (this matches the web client). Once `call:accept`
  ///    has arrived the launch owns the callId and teardown is the roulette
  ///    engine's `stop()` (`call:end { callId }`), not this ring.
  void decline() {
    final ring = state.ring;
    if (ring == null) return;
    _clearRingTimeout();
    final callId = ring.callId;
    if (ring.isIncoming) {
      if (callId != null) _socket.callDecline(callId);
    } else {
      if (callId != null) _socket.callEnd(callId);
    }
    state = state.copyWith(clearRing: true);
  }

  /// Consume the pending launch exactly once (the host navigates, then clears).
  void consumeLaunch() {
    if (state.launch != null) state = state.copyWith(clearLaunch: true);
  }

  /// Consume the pending toast exactly once (the host shows it, then clears).
  void consumeToast() {
    if (state.toast != null) state = state.copyWith(clearToast: true);
  }

  // ───────────────────────────── Ring timeout ─────────────────────────────
  void _armRingTimeout() {
    _clearRingTimeout();
    _ringTimeout = Timer(kDirectCallRingTimeout, () {
      final ring = state.ring;
      if (ring == null) return;
      // Auto-decline/cancel an unanswered ring so it never hangs forever.
      decline();
    });
  }

  void _clearRingTimeout() {
    _ringTimeout?.cancel();
    _ringTimeout = null;
  }
}

/// The global direct-call host controller. Mounted app-wide (the [DirectCallHost]
/// watches it), it subscribes to the `call:*` events on the shared `/mm` socket.
final directCallControllerProvider =
    NotifierProvider<DirectCallController, DirectCallState>(
  DirectCallController.new,
);
