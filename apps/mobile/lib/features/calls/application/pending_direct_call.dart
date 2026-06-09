import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/direct_call_controller.dart';

/// One-shot hand-off channel between the global [DirectCallHost] and the routed
/// [RouletteScreen] for a direct (friend) call — the native twin of the web
/// `direct-call-store`.
///
/// Direct 1:1 calls are placed/answered from OUTSIDE the roulette stage (the
/// global ring sheet's Accept, or an outgoing invite that resolved on
/// `call:accept`), but the WebRTC engine that runs the call lives in the
/// `RouletteController` on the `/video` (or `/voice`) route. The host records a
/// [DirectCallLaunch] here and navigates; the freshly-mounted `RouletteScreen`
/// drains it EXACTLY ONCE in `initState` and invokes
/// `RouletteController.startDirectCall`, so the call connects to the friend
/// instead of dropping into the random matchmaking queue.
///
/// Consumed once via [consume] so a single hand-off can never be replayed (e.g.
/// by an `initState` racing a rebuild) into a second call. Intentionally NOT
/// persisted: a launch that isn't drained promptly is stale.
class PendingDirectCall extends Notifier<DirectCallLaunch?> {
  @override
  DirectCallLaunch? build() => null;

  /// Record a pending direct-call launch, replacing any prior un-consumed one.
  void set(DirectCallLaunch launch) => state = launch;

  /// Atomically read AND clear the pending launch (returns it, or `null`). The
  /// roulette screen calls this once on mount so the hand-off can't be replayed.
  DirectCallLaunch? consume() {
    final pending = state;
    if (pending != null) state = null;
    return pending;
  }
}

/// The pending direct-call hand-off. App-wide (the host writes it before
/// navigating; the roulette screen drains it on mount).
final pendingDirectCallProvider =
    NotifierProvider<PendingDirectCall, DirectCallLaunch?>(
  PendingDirectCall.new,
);
