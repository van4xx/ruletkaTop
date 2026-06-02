import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/di.dart';
import '../../../core/models/models.dart';
import '../../../core/router/routes.dart';
import '../../../core/theme/theme.dart';
import '../../../core/widgets/widgets.dart';
import '../../notifications/domain/notifications_controller.dart';
import 'dashboard_providers.dart';
import 'widgets/daily_bonus_card.dart';
import 'widgets/online_friends_section.dart';
import 'widgets/profile_block.dart';
import 'widgets/quick_launch.dart';
import 'widgets/recent_chats_section.dart';
import 'widgets/top_feed_section.dart';

/// The authenticated hub mirroring the web `/dashboard`. A pull-to-refresh
/// scroll view composing, top to bottom:
///   1. a personal welcome header
///   2. the identity / profile block (avatar, premium, balance, views teaser)
///   3. the big quick-launch tiles (Видеочат → /video, Голосовой → /voice)
///   4. the signature dual-marquee Top feed
///   5. the daily-bonus card
///   6. the online-friends strip
///   7. the recent-chats preview
///
/// The app bar carries the gradient wordmark, a coin-balance pill (→ wallet,
/// "+" → coins) and the notifications bell. Presence for the friends strip is
/// seeded from the friends list and kept live over the socket.
class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  @override
  void initState() {
    super.initState();
    // Once the friends list resolves, seed + subscribe presence for them.
    ref.listenManual(friendsProvider, (prev, next) {
      final friends = next.value;
      if (friends == null || friends.isEmpty) return;
      final seed = {for (final f in friends) f.profile.id: f.status};
      final ids = friends.map((f) => f.profile.id).toList(growable: false);
      ref.read(presenceProvider.notifier).seed(seed, ids);
    }, fireImmediately: true);
  }

  Future<void> _refresh() async {
    ref.invalidate(myProfileProvider);
    ref.invalidate(walletProvider);
    ref.invalidate(topFeedProvider);
    ref.invalidate(friendsProvider);
    ref.invalidate(recentChatsProvider);
    // Await the primary sections so the indicator reflects real progress. Each
    // section renders its own error state, so failures here are swallowed.
    Future<void> settle(Future<Object?> f) async {
      try {
        await f;
      } catch (_) {/* section-local error handling covers this */}
    }

    await Future.wait([
      settle(ref.read(myProfileProvider.future)),
      settle(ref.read(walletProvider.future)),
      settle(ref.read(topFeedProvider.future)),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final walletAsync = ref.watch(walletProvider);
    final balance = walletAsync.value?.balanceCoins ?? 0;
    final unread = ref.watch(notificationsUnreadProvider);

    return AppScaffold(
      showWordmark: true,
      currentRoute: AppRoutes.dashboard,
      actions: [
        CoinBalancePill(
          balance: balance,
          onTap: () => context.go(AppRoutes.wallet),
          onAddTap: () => context.go(AppRoutes.coins),
        ),
        NotificationsButton(count: unread),
        const SizedBox(width: AppSpacing.xs),
      ],
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.xxxl),
          children: const [
            _WelcomeHeader(),
            SizedBox(height: AppSpacing.lg),
            ProfileBlock(),
            SizedBox(height: AppSpacing.lg),
            QuickLaunch(),
            SizedBox(height: AppSpacing.lg),
            TopFeedSection(),
            SizedBox(height: AppSpacing.lg),
            DailyBonusCard(),
            SizedBox(height: AppSpacing.lg),
            OnlineFriendsSection(),
            SizedBox(height: AppSpacing.lg),
            RecentChatsSection(),
          ],
        ),
      ),
    );
  }
}

/// A personalised greeting using the session user's nickname + a time-of-day
/// salutation.
class _WelcomeHeader extends ConsumerWidget {
  const _WelcomeHeader();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AuthUser? user = ref.watch(currentUserProvider);
    final nickname = user?.nickname ?? '';
    final hour = DateTime.now().hour;
    final greeting = switch (hour) {
      >= 5 && < 12 => 'Доброе утро',
      >= 12 && < 18 => 'Добрый день',
      >= 18 && < 23 => 'Добрый вечер',
      _ => 'Доброй ночи',
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          nickname.isEmpty ? '$greeting!' : '$greeting, $nickname',
          style: context.texts.headlineMedium,
        ),
        const SizedBox(height: 2),
        Text(
          'Готовы к новым знакомствам?',
          style: context.texts.bodyMedium
              ?.copyWith(color: context.scheme.onSurfaceVariant),
        ),
      ],
    );
  }
}
