import 'package:flutter/material.dart';

import '../widgets/widgets.dart';

/// A themed placeholder for routes whose feature screen hasn't been built yet.
///
/// The FOUNDATION wires every route to one of these so the app navigates and
/// analyzes cleanly from day one. FEATURE AGENTS replace the placeholder with
/// their real screen by swapping the `builder` in `router.dart` (see the
/// "ROUTE REGISTRATION" doc block there). Keeping a placeholder per route means
/// a half-finished app never crashes on navigation.
class PlaceholderScreen extends StatelessWidget {
  const PlaceholderScreen({
    super.key,
    required this.title,
    required this.icon,
    this.currentRoute,
    this.showBottomNav = true,
    this.note,
  });

  final String title;
  final IconData icon;
  final String? currentRoute;
  final bool showBottomNav;

  /// Optional sub-note (e.g. "owned by social-agent").
  final String? note;

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: title,
      currentRoute: currentRoute,
      showBottomNav: showBottomNav,
      body: EmptyState(
        icon: icon,
        title: title,
        message: note ?? 'Этот раздел скоро появится.',
      ),
    );
  }
}
