import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api.dart';
import '../di/di.dart';
import '../models/models.dart';

/// ─────────────────────────────────────────────────────────────────────────
/// Public operational status (`GET /public/status`).
///
/// An UNAUTHENTICATED snapshot of the live, admin-toggleable flags
/// (`maintenanceMode`, `registrationOpen`, `matchmakingEnabled`). The shells
/// read it to show a non-blocking maintenance banner on the dashboard and to
/// pre-disable the register form BEFORE the user hits the gated endpoint — the
/// server still ENFORCES each gate, this is purely a UX hint.
///
/// Fetched once on first watch (app start / dashboard load / register load) and
/// refreshed on app resume via [PublicStatusResumeRefresher]. We deliberately
/// do NOT poll: the flags change rarely (an admin toggle), so a fetch-on-load
/// plus refresh-on-resume keeps it current without hammering the endpoint.
/// ─────────────────────────────────────────────────────────────────────────

/// The live public status. Resolves to a permissive default shape on transport
/// failure (the underlying model defaults to "everything open"), so a flaky
/// network never falsely shows a maintenance banner or blocks registration.
final publicStatusProvider = FutureProvider<PublicStatus>((ref) async {
  final ApiClient api = ref.watch(apiClientProvider);
  try {
    return await api.publicStatus();
  } on ApiException {
    // Degrade to the open/default status — never nag or block on a fetch error.
    return const PublicStatus();
  }
});

/// Mounts an app-lifecycle listener that invalidates [publicStatusProvider] on
/// resume (so the flags refresh when the user returns to the app), without any
/// aggressive polling. Drop one instance high in the authenticated tree (e.g.
/// the dashboard) — it renders [child] untouched.
class PublicStatusResumeRefresher extends ConsumerStatefulWidget {
  const PublicStatusResumeRefresher({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<PublicStatusResumeRefresher> createState() =>
      _PublicStatusResumeRefresherState();
}

class _PublicStatusResumeRefresherState
    extends ConsumerState<PublicStatusResumeRefresher> {
  late final AppLifecycleListener _listener;

  @override
  void initState() {
    super.initState();
    _listener = AppLifecycleListener(
      onResume: () => ref.invalidate(publicStatusProvider),
    );
  }

  @override
  void dispose() {
    _listener.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
