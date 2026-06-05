import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/routes.dart';
import '../../../core/theme/theme.dart';
import '../../../core/widgets/widgets.dart';
import '../domain/economy_providers.dart';
import '../domain/top_feed_view.dart';
import 'widgets/top_placement_card.dart';
import 'widgets/top_purchase_sheet.dart';

/// `/top` — «Топ эфира»: the paid-placements feed.
///
/// Two ranked lanes of profiles who bought a spot, each card tapping through to
/// the public profile, plus a prominent "Купить место в Топе" CTA opening the
/// [TopPurchaseSheet]. Reads the hydrated [topFeedViewProvider]; loading /
/// empty / error are handled per the shared kit.
class TopScreen extends ConsumerWidget {
  const TopScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final feedAsync = ref.watch(topFeedViewProvider);
    final balance = ref.watch(coinBalanceProvider);

    return AppScaffold(
      title: 'Топ эфира',
      currentRoute: AppRoutes.top,
      actions: [
        CoinBalancePill(
          balance: balance ?? 0,
          onTap: () => context.push(AppRoutes.wallet),
          onAddTap: () => context.push(AppRoutes.coins),
        ),
        const SizedBox(width: AppSpacing.xs),
      ],
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(walletProvider);
          ref.invalidate(topFeedProvider);
          await ref
              .read(topFeedViewProvider.future)
              .catchError((_) => TopFeedView.empty);
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg,
            AppSpacing.lg,
            AppSpacing.lg,
            AppSpacing.xxxl,
          ),
          children: [
            const _Eyebrow(),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'Поднимитесь на вершину',
              style: AppTypography.display(
                fontSize: 26,
                color: context.scheme.onSurface,
              ),
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Места в Топе показываются всем на главной. Сделайте ставку монетами — '
              'чем больше ставка, тем выше вы в ленте.',
              style: context.texts.bodyMedium?.copyWith(
                color: context.scheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            _BuyBand(onBuy: () => _openPurchase(context, ref)),
            const SizedBox(height: AppSpacing.xl),
            feedAsync.when(
              loading: () => const _FeedSkeleton(),
              error: (_, _) => Padding(
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
                child: ErrorView(
                  title: 'Топ недоступен',
                  message: 'Не удалось загрузить ленту Топа.',
                  onRetry: () => ref.invalidate(topFeedProvider),
                ),
              ),
              data: (feed) => _FeedBody(
                feed: feed,
                onBuy: () => _openPurchase(context, ref),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openPurchase(BuildContext context, WidgetRef ref) async {
    final lanes = ref.read(topFeedViewProvider).value;
    await TopPurchaseSheet.show(
      context,
      // Seed the sheet with the current top bid per lane so the suggested bid
      // can out-rank the leader.
      topLeftBid: _topBid(lanes?.left),
      topRightBid: _topBid(lanes?.right),
    );
  }

  static int _topBid(List<TopFeedEntry>? lane) {
    if (lane == null || lane.isEmpty) return 0;
    return lane.first.placement.coinsSpent;
  }
}

/// The two-lane feed body (or a graceful per-lane hint when a lane is empty).
class _FeedBody extends StatelessWidget {
  const _FeedBody({required this.feed, required this.onBuy});

  final TopFeedView feed;
  final VoidCallback onBuy;

  @override
  Widget build(BuildContext context) {
    if (feed.isEmpty) {
      return EmptyState(
        icon: Icons.emoji_events_outlined,
        title: 'В Топе пока пусто',
        message: 'Обе дорожки свободны — станьте первым, кого здесь увидят.',
        actionLabel: 'Купить место в Топе',
        onAction: onBuy,
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Lane(
          title: 'Дорожка 1',
          accent: context.colors.neonViolet,
          entries: feed.left,
        ),
        const SizedBox(height: AppSpacing.xl),
        _Lane(
          title: 'Дорожка 2',
          accent: context.colors.neonCyan,
          entries: feed.right,
        ),
      ],
    );
  }
}

/// One ranked lane: a labelled header + a vertical list of placement cards
/// (rank = position in the list). An empty lane shows an inviting hint.
class _Lane extends StatelessWidget {
  const _Lane({
    required this.title,
    required this.accent,
    required this.entries,
  });

  final String title;
  final Color accent;
  final List<TopFeedEntry> entries;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                color: accent,
                shape: BoxShape.circle,
                boxShadow: AppShadows.glow(accent, strength: 0.6),
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Text(title, style: context.texts.titleMedium),
            const SizedBox(width: AppSpacing.sm),
            Text(
              '${entries.length}',
              style: context.texts.labelMedium?.copyWith(
                color: context.scheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.md),
        if (entries.isEmpty)
          _LaneEmpty(accent: accent)
        else
          for (var i = 0; i < entries.length; i++) ...[
            if (i > 0) const SizedBox(height: AppSpacing.sm),
            TopPlacementCard(
              entry: entries[i],
              rank: i + 1,
              onTap: () =>
                  context.push(AppRoutes.profileOf(entries[i].profile.id)),
            ),
          ],
      ],
    );
  }
}

class _LaneEmpty extends StatelessWidget {
  const _LaneEmpty({required this.accent});

  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.lg,
      ),
      decoration: BoxDecoration(
        borderRadius: AppRadii.brXl,
        color: accent.withValues(alpha: 0.06),
        border: Border.all(color: accent.withValues(alpha: 0.28)),
      ),
      child: Row(
        children: [
          Icon(Icons.add_circle_outline_rounded, size: 20, color: accent),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              'Дорожка свободна — займите место!',
              style: context.texts.bodySmall?.copyWith(
                color: context.scheme.onSurfaceVariant,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The signature "buy a placement" CTA band.
class _BuyBand extends StatelessWidget {
  const _BuyBand({required this.onBuy});

  final VoidCallback onBuy;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return GlassCard(
      borderRadius: AppRadii.brXxl,
      glowColor: colors.warning,
      glowStrength: 0.4,
      intensity: 1.1,
      padding: EdgeInsets.zero,
      child: Stack(
        children: [
          // Gold→violet wash filling the showcase.
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    colors.warning.withValues(alpha: 0.18),
                    Colors.transparent,
                    colors.neonViolet.withValues(alpha: 0.18),
                  ],
                  stops: const [0.0, 0.55, 1.0],
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Container(
                      width: 50,
                      height: 50,
                      decoration: BoxDecoration(
                        borderRadius: AppRadii.brXl,
                        gradient: LinearGradient(
                          colors: [colors.warning, colors.neonMagenta],
                        ),
                        boxShadow: AppShadows.glow(
                          colors.warning,
                          strength: 0.55,
                        ),
                      ),
                      child: const Icon(
                        Icons.emoji_events_rounded,
                        color: Colors.white,
                        size: 27,
                      ),
                    ),
                    const SizedBox(width: AppSpacing.lg),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Хотите оказаться здесь?',
                            style: context.texts.titleMedium?.copyWith(
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'Купите место и будьте на виду у всех.',
                            style: context.texts.bodySmall?.copyWith(
                              color: context.scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.lg),
                GradientButton(
                  label: 'Купить место в Топе',
                  icon: Icons.emoji_events_rounded,
                  gradientColors: [colors.warning, colors.neonMagenta],
                  onPressed: onBuy,
                  height: 50,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The small uppercase section label above the screen title.
class _Eyebrow extends StatelessWidget {
  const _Eyebrow();

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Row(
      children: [
        Icon(Icons.trending_up_rounded, size: 16, color: colors.neonMagenta),
        const SizedBox(width: AppSpacing.xs),
        Text(
          'ТОП ЭФИРА',
          style: AppTypography.eyebrow(fontSize: 11, color: colors.neonMagenta),
        ),
      ],
    );
  }
}

/// A skeleton mirroring the two-lane layout while the feed hydrates.
class _FeedSkeleton extends StatelessWidget {
  const _FeedSkeleton();

  @override
  Widget build(BuildContext context) {
    Widget lane() => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const ShimmerBox(width: 100, height: 16),
        const SizedBox(height: AppSpacing.md),
        for (var i = 0; i < 3; i++) ...[
          if (i > 0) const SizedBox(height: AppSpacing.sm),
          Container(
            height: 72,
            decoration: BoxDecoration(
              color: context.scheme.surfaceContainerHighest,
              borderRadius: AppRadii.brXl,
            ),
          ),
        ],
      ],
    );

    return LoadingShimmer(
      child: Column(
        children: [
          lane(),
          const SizedBox(height: AppSpacing.xl),
          lane(),
        ],
      ),
    );
  }
}
