import 'package:flutter/material.dart';

/// Canonical route paths for the app — the SINGLE SOURCE OF TRUTH, mirroring
/// the web's `ROUTES` registry (`apps/web/src/config/nav.ts`). Feature agents
/// reference [AppRoutes] constants instead of hard-coding path strings.
///
/// Paths are flat (top-level go_router routes) so deep links and `context.go`
/// are predictable. Parameterized routes expose a builder for the concrete URL.
abstract final class AppRoutes {
  // ── Auth (public) ──
  static const String login = '/login';
  static const String register = '/register';
  static const String forgotPassword = '/forgot-password';

  /// Reset-password landing (from the emailed link). The single-use token is
  /// read from the `token` query parameter (`/reset-password?token=…`).
  static const String resetPassword = '/reset-password';

  /// Email-verification landing (from the emailed link). The token is read from
  /// the `token` query parameter (`/verify-email?token=…`).
  static const String verifyEmail = '/verify-email';

  // ── Authenticated hub + roulette ──
  static const String dashboard = '/dashboard';
  static const String video = '/video';
  static const String voice = '/voice';

  // ── Social ──
  static const String friends = '/friends';
  static const String friendRequests = '/friends/requests';
  static const String chats = '/chats';

  /// Chat thread by conversation id.
  static const String chat = '/chat/:id';
  static String chatTo(String conversationId) => '/chat/$conversationId';

  /// Canonical thread route alias mirroring the web (`/chats/:id`). The API
  /// emits message-notification deep links in this canonical form, so the alias
  /// lets the same link resolve on mobile as well as web.
  static const String chatAlias = '/chats/:id';

  /// Public profile by user id.
  static const String profile = '/profile/:id';
  static String profileOf(String userId) => '/profile/$userId';

  /// The current user's own profile.
  static const String me = '/profile/me';

  // ── Economy ──
  static const String top = '/top';
  static const String coins = '/coins';
  static const String gifts = '/gifts';
  static const String premium = '/premium';
  static const String wallet = '/wallet';

  // ── Discovery / utility ──
  static const String search = '/search';
  static const String leaderboard = '/leaderboard';
  static const String notifications = '/notifications';
  static const String settings = '/settings';

  /// Set of public (unauthenticated-allowed) routes used by the guard. The
  /// email-link landings (`forgotPassword`/`resetPassword`/`verifyEmail`) are
  /// public so a signed-out user can recover their account.
  static const Set<String> publicRoutes = {
    login,
    register,
    forgotPassword,
    resetPassword,
    verifyEmail,
  };
}

/// A bottom-navigation destination. The shell renders these as the primary
/// tabs; everything else is reached via the dashboard, app-bar actions or
/// pushed routes. Order is intentional (roulette is the hero).
class NavDestination {
  const NavDestination({
    required this.route,
    required this.label,
    required this.icon,
    required this.selectedIcon,
  });

  final String route;
  final String label;
  final IconData icon;
  final IconData selectedIcon;
}

/// The 5 primary tabs surfaced in the bottom nav (Russian-first labels).
const List<NavDestination> kBottomNavDestinations = [
  NavDestination(
    route: AppRoutes.dashboard,
    label: 'Главная',
    icon: Icons.dashboard_outlined,
    selectedIcon: Icons.dashboard_rounded,
  ),
  NavDestination(
    route: AppRoutes.video,
    label: 'Рулетка',
    icon: Icons.videocam_outlined,
    selectedIcon: Icons.videocam_rounded,
  ),
  NavDestination(
    route: AppRoutes.chats,
    label: 'Чаты',
    icon: Icons.chat_bubble_outline_rounded,
    selectedIcon: Icons.chat_bubble_rounded,
  ),
  NavDestination(
    route: AppRoutes.friends,
    label: 'Друзья',
    icon: Icons.people_alt_outlined,
    selectedIcon: Icons.people_alt_rounded,
  ),
  NavDestination(
    route: AppRoutes.me,
    label: 'Профиль',
    icon: Icons.person_outline_rounded,
    selectedIcon: Icons.person_rounded,
  ),
];
