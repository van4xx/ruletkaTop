import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../di/di.dart';
import '../models/models.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/auth/presentation/register_screen.dart';
import '../../features/dashboard/presentation/dashboard_screen.dart';
import '../../features/roulette/presentation/roulette_screen.dart';
import '../../features/friends/presentation/friends_screen.dart';
import '../../features/friends/presentation/friend_requests_screen.dart';
import '../../features/chat/presentation/chats_screen.dart';
import '../../features/chat/presentation/chat_thread_screen.dart';
import '../../features/profile/presentation/my_profile_screen.dart';
import '../../features/profile/presentation/public_profile_screen.dart';
import '../../features/economy/presentation/top_screen.dart';
import '../../features/economy/presentation/coins_screen.dart';
import '../../features/economy/presentation/gifts_screen.dart';
import '../../features/economy/presentation/premium_screen.dart';
import '../../features/economy/presentation/wallet_screen.dart';
import '../../features/search/presentation/search_screen.dart';
import '../../features/settings/presentation/settings_screen.dart';
import '../../features/leaderboard/presentation/leaderboard_screen.dart';
import '../../features/notifications/presentation/notifications_screen.dart';
import 'placeholder_screen.dart';
import 'routes.dart';
import 'splash_screen.dart';

/// ════════════════════════════════════════════════════════════════════════
/// ROUTE REGISTRATION — the app's single [GoRouter].
///
/// Every app route is wired to its real feature screen. The auth-redirect guard
/// (below) gates protected routes: unauthenticated users are sent to /login and
/// authenticated users are kept out of /login|/register. Screens never repeat
/// the auth check. Each tab screen renders [AppScaffold] itself (flat top-level
/// routes; no ShellRoute), passing `currentRoute:` to light up the right tab.
///
/// Conventions:
///  • Use the path CONSTANTS from [AppRoutes] (never hard-code strings).
///  • Read a path param via `state.pathParameters['id']` (see /chat/:id,
///    /profile/:id below).
///  • /profile/me is registered BEFORE /profile/:id so the literal wins over the
///    param (go_router matches in declaration order).
/// ════════════════════════════════════════════════════════════════════════

/// Bridges the Riverpod [authStateProvider] to a [Listenable] so GoRouter
/// re-evaluates its [GoRouter.redirect] whenever the auth status changes
/// (login, logout, bootstrap completion).
class _AuthListenable extends ChangeNotifier {
  _AuthListenable(this._ref) {
    _sub = _ref.listen<AuthState>(
      authStateProvider,
      (prev, next) {
        // Only notify on transitions that affect routing.
        if (prev?.status != next.status) notifyListeners();
      },
      fireImmediately: false,
    );
  }

  final Ref _ref;
  late final ProviderSubscription<AuthState> _sub;

  @override
  void dispose() {
    _sub.close();
    super.dispose();
  }
}

/// The app router, exposed as a provider so the guard can read auth state.
final routerProvider = Provider<GoRouter>((ref) {
  final authListenable = _AuthListenable(ref);
  ref.onDispose(authListenable.dispose);

  return GoRouter(
    initialLocation: AppRoutes.dashboard,
    refreshListenable: authListenable,
    debugLogDiagnostics: false,
    redirect: (context, state) {
      final auth = ref.read(authStateProvider);
      final location = state.matchedLocation;
      final isPublic = AppRoutes.publicRoutes.contains(location);

      // Hold on the splash until bootstrap resolves the session.
      if (auth.isUnknown) {
        return location == _splashLocation ? null : _splashLocation;
      }

      // Leave the splash once we know the status.
      if (location == _splashLocation) {
        return auth.isAuthenticated ? AppRoutes.dashboard : AppRoutes.login;
      }

      if (!auth.isAuthenticated && !isPublic) {
        // Gate protected routes.
        return AppRoutes.login;
      }
      if (auth.isAuthenticated && isPublic) {
        // Authenticated users shouldn't see login/register.
        return AppRoutes.dashboard;
      }
      return null; // no redirect
    },
    routes: [
      // ── Splash (internal; only reachable via the guard during bootstrap) ──
      GoRoute(path: _splashLocation, builder: (_, _) => const SplashScreen()),

      // ── Auth (public) ──
      GoRoute(path: AppRoutes.login, builder: (_, _) => const LoginScreen()),
      GoRoute(path: AppRoutes.register, builder: (_, _) => const RegisterScreen()),

      // ── Authenticated hub + roulette ──
      GoRoute(path: AppRoutes.dashboard, builder: (_, _) => const DashboardScreen()),
      GoRoute(
        path: AppRoutes.video,
        builder: (_, _) => const RouletteScreen(type: MatchType.video),
      ),
      GoRoute(
        path: AppRoutes.voice,
        builder: (_, _) => const RouletteScreen(type: MatchType.voice),
      ),

      // ── Social ──
      GoRoute(path: AppRoutes.friends, builder: (_, _) => const FriendsScreen()),
      GoRoute(path: AppRoutes.friendRequests, builder: (_, _) => const FriendRequestsScreen()),
      GoRoute(path: AppRoutes.chats, builder: (_, _) => const ChatsScreen()),
      GoRoute(
        path: AppRoutes.chat,
        builder: (_, state) =>
            ChatThreadScreen(conversationId: state.pathParameters['id'] ?? ''),
      ),

      // ── Profiles ── (literal /profile/me BEFORE /profile/:id) ──
      GoRoute(path: AppRoutes.me, builder: (_, _) => const MyProfileScreen()),
      GoRoute(
        path: AppRoutes.profile,
        builder: (_, state) =>
            PublicProfileScreen(userId: state.pathParameters['id'] ?? ''),
      ),

      // ── Economy ──
      GoRoute(path: AppRoutes.top, builder: (_, _) => const TopScreen()),
      GoRoute(path: AppRoutes.coins, builder: (_, _) => const CoinsScreen()),
      GoRoute(path: AppRoutes.gifts, builder: (_, _) => const GiftsScreen()),
      GoRoute(path: AppRoutes.premium, builder: (_, _) => const PremiumScreen()),
      GoRoute(path: AppRoutes.wallet, builder: (_, _) => const WalletScreen()),

      // ── Discovery / utility ──
      GoRoute(path: AppRoutes.search, builder: (_, _) => const SearchScreen()),
      GoRoute(
        path: AppRoutes.leaderboard,
        builder: (_, _) => const LeaderboardScreen(),
      ),
      GoRoute(
        path: AppRoutes.notifications,
        builder: (_, _) => const NotificationsScreen(),
      ),
      GoRoute(path: AppRoutes.settings, builder: (_, _) => const SettingsScreen()),
    ],
    errorBuilder: (_, state) => PlaceholderScreen(
      title: 'Страница не найдена',
      icon: Icons.broken_image_rounded,
      showBottomNav: false,
      note: 'Нет маршрута для ${state.uri}',
    ),
  );
});

/// Internal splash location (not part of [AppRoutes] — used only by the guard).
const String _splashLocation = '/splash';
