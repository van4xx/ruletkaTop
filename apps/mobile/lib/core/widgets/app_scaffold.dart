import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../router/routes.dart';
import '../theme/theme.dart';

/// The app's standard page chrome, mirroring the web header essentials: a
/// gradient wordmark, optional title, trailing actions (e.g. a coin pill /
/// notifications bell) and a glassy bottom navigation bar over the dark void.
///
/// Usage:
/// ```dart
/// AppScaffold(
///   title: 'Друзья',
///   currentRoute: AppRoutes.friends,    // highlights the bottom-nav tab
///   actions: [NotificationsButton(), CoinBalancePill(...)],
///   body: ...,
/// )
/// ```
/// Pass `showBottomNav: false` + `currentRoute: null` for full-screen pages
/// (e.g. the roulette call view) that manage their own chrome.
class AppScaffold extends StatelessWidget {
  const AppScaffold({
    super.key,
    required this.body,
    this.title,
    this.currentRoute,
    this.actions,
    this.leading,
    this.showAppBar = true,
    this.showBottomNav = true,
    this.showWordmark = false,
    this.floatingActionButton,
    this.backgroundDecoration = true,
    this.bottom,
  });

  final Widget body;

  /// App-bar title (omitted when [showWordmark] is true and this is null).
  final String? title;

  /// The active route — highlights the matching bottom-nav tab. When null, no
  /// tab is highlighted (e.g. on a pushed sub-page).
  final String? currentRoute;

  final List<Widget>? actions;
  final Widget? leading;
  final bool showAppBar;
  final bool showBottomNav;

  /// Show the gradient "ruletka" wordmark as the app-bar title.
  final bool showWordmark;
  final Widget? floatingActionButton;

  /// Paint the signature radial neon ambience behind the body.
  final bool backgroundDecoration;

  /// Optional app-bar bottom (e.g. a TabBar or search field).
  final PreferredSizeWidget? bottom;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      extendBodyBehindAppBar: false,
      appBar: showAppBar
          ? AppBar(
              leading: leading,
              title: showWordmark ? const _Wordmark() : (title != null ? Text(title!) : null),
              actions: actions,
              bottom: bottom,
            )
          : null,
      body: backgroundDecoration ? _AmbientBackground(child: body) : body,
      floatingActionButton: floatingActionButton,
      bottomNavigationBar:
          showBottomNav ? _BottomNav(currentRoute: currentRoute) : null,
    );
  }
}

/// The gradient "ruletka" wordmark (Unbounded display, violet→cyan→magenta).
class _Wordmark extends StatelessWidget {
  const _Wordmark();

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return ShaderMask(
      shaderCallback: (bounds) => LinearGradient(colors: colors.brandGradient).createShader(bounds),
      child: Text(
        'ruletka',
        style: AppTypography.display(fontSize: 22, color: Colors.white, letterSpacing: -1),
      ),
    );
  }
}

/// A faint radial neon glow anchored top-center — the app's atmospheric
/// backdrop, echoing the web's layered void.
class _AmbientBackground extends StatelessWidget {
  const _AmbientBackground({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    if (!context.isDark) return child;
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: const Alignment(0, -1.1),
          radius: 1.3,
          colors: [
            colors.neonViolet.withValues(alpha: 0.10),
            context.scheme.surface,
          ],
          stops: const [0, 0.6],
        ),
      ),
      child: child,
    );
  }
}

/// The glassy bottom navigation, driven by [kBottomNavDestinations]. Navigating
/// uses `context.go` so tabs replace (not stack) the current location.
class _BottomNav extends StatelessWidget {
  const _BottomNav({this.currentRoute});

  final String? currentRoute;

  int get _selectedIndex {
    if (currentRoute == null) return 0;
    final idx = kBottomNavDestinations.indexWhere((d) => d.route == currentRoute);
    return idx < 0 ? 0 : idx;
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final hasSelection =
        currentRoute != null && kBottomNavDestinations.any((d) => d.route == currentRoute);

    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: colors.glassBorder)),
      ),
      child: NavigationBar(
        selectedIndex: _selectedIndex,
        onDestinationSelected: (i) {
          final dest = kBottomNavDestinations[i];
          if (dest.route != currentRoute) context.go(dest.route);
        },
        destinations: [
          for (var i = 0; i < kBottomNavDestinations.length; i++)
            NavigationDestination(
              icon: Icon(kBottomNavDestinations[i].icon),
              selectedIcon: Icon(
                kBottomNavDestinations[i].selectedIcon,
                color: hasSelection ? colors.neonViolet : null,
              ),
              label: kBottomNavDestinations[i].label,
            ),
        ],
      ),
    );
  }
}

/// A reusable notifications bell for app-bar [AppScaffold.actions], with an
/// optional unread [count] badge. Routes to the notifications center.
class NotificationsButton extends StatelessWidget {
  const NotificationsButton({super.key, this.count = 0, this.onTap});

  final int count;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: onTap ?? () => context.go(AppRoutes.notifications),
      icon: Badge(
        isLabelVisible: count > 0,
        label: Text(count > 99 ? '99+' : '$count'),
        child: const Icon(Icons.notifications_none_rounded),
      ),
      tooltip: 'Уведомления',
    );
  }
}
