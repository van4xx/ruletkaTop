import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/di.dart';
import '../../../core/models/models.dart';
import '../../../core/router/routes.dart';
import '../../../core/status/public_status_provider.dart';
import '../../../core/theme/theme.dart';
import '../../../core/widgets/widgets.dart';
import '../../notifications/domain/notifications_controller.dart';
import 'dashboard_providers.dart';
import 'widgets/dashboard_banners.dart';
import 'widgets/daily_bonus_card.dart';
import 'widgets/online_friends_section.dart';
import 'widgets/profile_block.dart';
import 'widgets/quick_launch.dart';
import 'widgets/recent_chats_section.dart';
import 'widgets/top_feed_section.dart';

/// The authenticated hub mirroring the web `/dashboard`. A pull-to-refresh
/// scroll view composing, top to bottom:
///   1. a compact horizontal welcome hero (gradient name + live pulse + a slim
///      dismissible lede strip), with a staggered entrance
///   2. the identity / profile block (avatar, premium, balance, views teaser)
///   3. the quick-launch tiles (Видео → /video, Голос → /voice, Топ → /top,
///      Поиск → /search)
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

    // Each top-level section animates in, gently staggered, on first build.
    // The hero is order 0 (it wraps itself in `_Reveal`); sections follow it.
    var step = 1;
    Widget reveal(Widget child) => _Reveal(order: step++, child: child);

    return AppScaffold(
      showWordmark: true,
      currentRoute: AppRoutes.dashboard,
      actions: [
        CoinBalancePill(
          balance: balance,
          onTap: () => context.push(AppRoutes.wallet),
          onAddTap: () => context.push(AppRoutes.coins),
        ),
        NotificationsButton(count: unread),
        const SizedBox(width: AppSpacing.xs),
      ],
      // Refresh the public status (maintenance flag) on app resume, no polling.
      body: PublicStatusResumeRefresher(
        child: RefreshIndicator(
          onRefresh: _refresh,
          edgeOffset: 8,
          color: context.colors.neonViolet,
          backgroundColor: context.scheme.surface,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.xxxl),
            children: [
              // Client-completeness notices (each renders nothing when N/A).
              const MaintenanceBanner(),
              const VerifyEmailBanner(),
              const _WelcomeHero(),
            const SizedBox(height: AppSpacing.xl),
            reveal(const ProfileBlock()),
            const SizedBox(height: AppSpacing.xl),
            reveal(const _DashSection(
              eyebrow: 'НАЧАТЬ ОБЩЕНИЕ',
              title: 'Запустить рулетку',
              child: QuickLaunch(),
            )),
            const SizedBox(height: AppSpacing.xl),
            reveal(const TopFeedSection()),
            const SizedBox(height: AppSpacing.lg),
            reveal(const DailyBonusCard()),
            const SizedBox(height: AppSpacing.lg),
            reveal(const OnlineFriendsSection()),
            const SizedBox(height: AppSpacing.lg),
            reveal(const RecentChatsSection()),
            ],
          ),
        ),
      ),
    );
  }
}

/// A labelled section: a wide-tracked neon eyebrow over a display-cased title,
/// then the section body. Mirrors the web's kicker-above-heading rhythm.
class _DashSection extends StatelessWidget {
  const _DashSection({
    required this.eyebrow,
    required this.title,
    required this.child,
  });

  final String eyebrow;
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 2, bottom: AppSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                eyebrow,
                style: AppTypography.eyebrow(color: colors.neonCyan),
              ),
              const SizedBox(height: 4),
              Text(title, style: context.texts.headlineSmall),
            ],
          ),
        ),
        child,
      ],
    );
  }
}

/// The compact welcome hero, ported from the web `DashboardWelcome`: a single
/// horizontal row with a time-of-day greeting (the nickname painted in the
/// brand gradient) and a glassy "online now" live-pulse pill pushed to the
/// trailing edge, plus a slim, dismissible glass lede strip below.
///
/// Dismissal of the lede is **in-memory only** (plain state), so — exactly like
/// the web — it reappears on a fresh load / pull-to-refresh remount.
class _WelcomeHero extends ConsumerStatefulWidget {
  const _WelcomeHero();

  @override
  ConsumerState<_WelcomeHero> createState() => _WelcomeHeroState();
}

class _WelcomeHeroState extends ConsumerState<_WelcomeHero> {
  bool _showLede = true;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final AuthUser? user = ref.watch(currentUserProvider);
    final nickname = user?.nickname ?? '';
    final hour = DateTime.now().hour;
    final greeting = switch (hour) {
      >= 5 && < 12 => 'Доброе утро',
      >= 12 && < 18 => 'Добрый день',
      >= 18 && < 23 => 'Добрый вечер',
      _ => 'Доброй ночи',
    };

    return _Reveal(
      order: 0,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                child: _GreetingLine(greeting: greeting, nickname: nickname),
              ),
              const SizedBox(width: AppSpacing.md),
              const _LiveNowPill(),
            ],
          ),
          AnimatedSize(
            duration: AppDurations.normal,
            curve: AppCurves.emphasized,
            alignment: Alignment.topCenter,
            child: _showLede
                ? Padding(
                    padding: const EdgeInsets.only(top: AppSpacing.md),
                    child: GlassCard(
                      padding: const EdgeInsets.fromLTRB(
                          AppSpacing.md, AppSpacing.sm, AppSpacing.sm, AppSpacing.sm),
                      borderRadius: AppRadii.brXl,
                      intensity: 0.7,
                      child: Row(
                        children: [
                          Icon(Icons.auto_awesome_rounded,
                              size: 16, color: colors.neonCyan),
                          const SizedBox(width: AppSpacing.sm),
                          Expanded(
                            child: Text(
                              'Ваш центр управления — звонки, друзья и Топ эфира в одном месте.',
                              style: context.texts.bodySmall?.copyWith(
                                  color: context.scheme.onSurfaceVariant),
                            ),
                          ),
                          const SizedBox(width: AppSpacing.xs),
                          _LedeDismiss(
                            onTap: () => setState(() => _showLede = false),
                          ),
                        ],
                      ),
                    ),
                  )
                : const SizedBox(width: double.infinity),
          ),
        ],
      ),
    );
  }
}

/// "Доброе утро, **nickname**" — the salutation in the foreground, the nickname
/// painted with the brand gradient via a [ShaderMask].
class _GreetingLine extends StatelessWidget {
  const _GreetingLine({required this.greeting, required this.nickname});

  final String greeting;
  final String nickname;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    // Anchor the foreground color explicitly: the nickname is painted by a
    // ShaderMask, so the salutation needs its own onSurface color rather than
    // relying on inheritance through the WidgetSpan.
    final style =
        context.texts.headlineMedium?.copyWith(color: context.scheme.onSurface);

    if (nickname.isEmpty) {
      return Text('$greeting!',
          maxLines: 2, overflow: TextOverflow.ellipsis, style: style);
    }

    return Text.rich(
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
      TextSpan(
        style: style,
        children: [
          TextSpan(text: '$greeting, '),
          WidgetSpan(
            alignment: PlaceholderAlignment.baseline,
            baseline: TextBaseline.alphabetic,
            child: ShaderMask(
              shaderCallback: (bounds) => AppGradients.brand(
                colors,
                begin: Alignment.centerLeft,
                end: Alignment.centerRight,
              ).createShader(bounds),
              child: Text(nickname, style: style?.copyWith(color: Colors.white)),
            ),
          ),
        ],
      ),
    );
  }
}

/// A glassy "online now" pill with a softly pinging cyan dot.
class _LiveNowPill extends StatefulWidget {
  const _LiveNowPill();

  @override
  State<_LiveNowPill> createState() => _LiveNowPillState();
}

class _LiveNowPillState extends State<_LiveNowPill>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1600),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final reduceMotion = MediaQuery.maybeOf(context)?.disableAnimations ?? false;

    Widget dot() => DecoratedBox(
          decoration: BoxDecoration(shape: BoxShape.circle, color: colors.neonCyan),
          child: const SizedBox(width: 7, height: 7),
        );

    return ClipRRect(
      borderRadius: AppRadii.brPill,
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: AppBlur.subtle, sigmaY: AppBlur.subtle),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 7),
          decoration: BoxDecoration(
            borderRadius: AppRadii.brPill,
            color: colors.glassFill,
            border: Border.all(color: colors.glassBorder),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: 7,
                height: 7,
                child: reduceMotion
                    ? dot()
                    : AnimatedBuilder(
                        animation: _controller,
                        builder: (context, _) => Stack(
                          alignment: Alignment.center,
                          children: [
                            Transform.scale(
                              scale: 1 + _controller.value * 1.8,
                              child: Opacity(
                                opacity: (1 - _controller.value) * 0.7,
                                child: dot(),
                              ),
                            ),
                            dot(),
                          ],
                        ),
                      ),
              ),
              const SizedBox(width: 7),
              Text(
                'Сейчас онлайн',
                style: context.texts.labelSmall?.copyWith(
                    color: context.scheme.onSurfaceVariant,
                    fontWeight: FontWeight.w700),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The lede's round close affordance.
class _LedeDismiss extends StatelessWidget {
  const _LedeDismiss({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: onTap,
      iconSize: 16,
      visualDensity: VisualDensity.compact,
      padding: EdgeInsets.zero,
      constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
      color: context.scheme.onSurfaceVariant,
      icon: const Icon(Icons.close_rounded),
      tooltip: 'Скрыть',
    );
  }
}

/// A one-shot entrance: a section fades up into place with a small stagger
/// derived from its [order]. Honors reduced-motion (renders instantly). Runs
/// once per mount — pull-to-refresh keeps the same widgets, so it won't replay
/// on data refresh, only on a fresh navigation to the hub.
class _Reveal extends StatefulWidget {
  const _Reveal({required this.order, required this.child});

  final int order;
  final Widget child;

  @override
  State<_Reveal> createState() => _RevealState();
}

class _RevealState extends State<_Reveal> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: AppDurations.slow,
  );
  late final Animation<double> _opacity =
      CurvedAnimation(parent: _controller, curve: Curves.easeOut);
  late final Animation<Offset> _offset = Tween<Offset>(
    begin: const Offset(0, 0.06),
    end: Offset.zero,
  ).animate(CurvedAnimation(parent: _controller, curve: AppCurves.emphasized));

  @override
  void initState() {
    super.initState();
    final reduceMotion =
        WidgetsBinding.instance.platformDispatcher.accessibilityFeatures.disableAnimations;
    if (reduceMotion) {
      _controller.value = 1;
    } else {
      Future<void>.delayed(
        Duration(milliseconds: 60 * widget.order),
        () {
          if (mounted) _controller.forward();
        },
      );
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _opacity,
      child: SlideTransition(position: _offset, child: widget.child),
    );
  }
}
