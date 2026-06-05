import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../router/routes.dart';
import '../theme/theme.dart';
import 'aurora_background.dart';

/// The app's standard page chrome, mirroring the web header essentials: a
/// gradient wordmark, optional title, trailing actions (e.g. a coin pill /
/// notifications bell) and a glassy bottom navigation bar floating over the
/// signature neon-aurora void.
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

  /// Paint the signature neon-aurora ambience behind the body.
  final bool backgroundDecoration;

  /// Optional app-bar bottom (e.g. a TabBar or search field).
  final PreferredSizeWidget? bottom;

  @override
  Widget build(BuildContext context) {
    // The body floats over the aurora. We keep the body laid out *below* the
    // app bar and *above* the nav bar (extend* = false) so every existing
    // screen renders exactly where it did before — the chrome is glassy, but
    // the safe content rect is unchanged, preserving all ~80 consumers.
    final scaffold = Scaffold(
      backgroundColor: Colors.transparent,
      appBar: showAppBar
          ? _GlassAppBar(
              leading: leading,
              titleWidget: showWordmark
                  ? const _Wordmark()
                  : (title != null ? Text(title!) : null),
              actions: actions,
              bottom: bottom,
            )
          : null,
      body: body,
      floatingActionButton: floatingActionButton,
      bottomNavigationBar:
          showBottomNav ? _BottomNav(currentRoute: currentRoute) : null,
    );

    if (!backgroundDecoration) {
      // Still give it the solid void base so transparent scaffold isn't black.
      return ColoredBox(color: context.scheme.surface, child: scaffold);
    }
    return AuroraBackground(child: scaffold);
  }
}

/// A glassmorphic [AppBar]: transparent base with a real backdrop blur and a
/// soft top-down scrim, so titles/actions stay legible as content scrolls
/// beneath it. Implements [PreferredSizeWidget] to drop into [Scaffold.appBar].
class _GlassAppBar extends StatelessWidget implements PreferredSizeWidget {
  const _GlassAppBar({
    this.leading,
    this.titleWidget,
    this.actions,
    this.bottom,
  });

  final Widget? leading;
  final Widget? titleWidget;
  final List<Widget>? actions;
  final PreferredSizeWidget? bottom;

  @override
  Size get preferredSize => Size.fromHeight(
        kToolbarHeight + (bottom?.preferredSize.height ?? 0),
      );

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;

    // The inner AppBar reserves the status-bar inset itself; the blur + scrim
    // wrap it (including that strip) so the whole top reads as one glass plane.
    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: AppBlur.heavy, sigmaY: AppBlur.heavy),
        child: DecoratedBox(
          decoration: BoxDecoration(
            // A vertical scrim: a touch of surface up top fading to clear, so
            // the bar reads over busy content without a hard edge.
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                scheme.surface.withValues(alpha: 0.72),
                scheme.surface.withValues(alpha: 0.0),
              ],
            ),
            border: Border(
              bottom: BorderSide(color: context.colors.glassBorder, width: 0.5),
            ),
          ),
          child: AppBar(
            backgroundColor: Colors.transparent,
            elevation: 0,
            scrolledUnderElevation: 0,
            leading: leading,
            title: titleWidget,
            actions: actions,
            bottom: bottom,
          ),
        ),
      ),
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
      shaderCallback: (bounds) =>
          AppGradients.brand(colors, begin: Alignment.centerLeft, end: Alignment.centerRight)
              .createShader(bounds),
      child: Text(
        'ruletka',
        style: AppTypography.wordmark(fontSize: 22, color: Colors.white),
      ),
    );
  }
}

/// The floating glass bottom navigation, driven by [kBottomNavDestinations].
/// Navigating uses `context.go` so tabs replace (not stack) the current
/// location. The bar is a true liquid-glass slab: backdrop blur, a translucent
/// fill, a hairline top highlight and an ambient shadow lifting it off content.
class _BottomNav extends StatelessWidget {
  const _BottomNav({this.currentRoute});

  final String? currentRoute;

  int get _selectedIndex {
    if (currentRoute == null) return 0;
    final idx =
        kBottomNavDestinations.indexWhere((d) => d.route == currentRoute);
    return idx < 0 ? 0 : idx;
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;
    final hasSelection = currentRoute != null &&
        kBottomNavDestinations.any((d) => d.route == currentRoute);

    final bar = ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: AppBlur.heavy, sigmaY: AppBlur.heavy),
        child: DecoratedBox(
          decoration: BoxDecoration(
            // Denser glass than a card so labels/icons stay crisp.
            color: scheme.surface.withValues(alpha: context.isDark ? 0.55 : 0.82),
            border: Border(
              top: BorderSide(color: colors.glassHighlight.withValues(alpha: 0.18)),
            ),
          ),
          child: NavigationBar(
            backgroundColor: Colors.transparent,
            surfaceTintColor: Colors.transparent,
            elevation: 0,
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
        ),
      ),
    );

    // A soft shadow above the bar grounds it as a floating slab.
    return DecoratedBox(
      decoration: const BoxDecoration(
        boxShadow: [
          BoxShadow(color: Color(0x40000000), blurRadius: 20, offset: Offset(0, -4)),
        ],
      ),
      child: bar,
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
      onPressed: onTap ?? () => context.push(AppRoutes.notifications),
      icon: Badge(
        isLabelVisible: count > 0,
        label: Text(count > 99 ? '99+' : '$count'),
        child: const Icon(Icons.notifications_none_rounded),
      ),
      tooltip: 'Уведомления',
    );
  }
}
