import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/router/routes.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../../data/dashboard_repository.dart';
import '../dashboard_providers.dart';
import 'dash_section_header.dart';

/// The dashboard's slice of the SIGNATURE Top feed: two horizontally-scrolling
/// marquee rows moving in OPPOSITE directions (top lane → right, bottom lane →
/// left), with edge fades and a prominent "Купить место в Топе" CTA. Mirrors
/// the web's dual `TopFeedMarquee`.
///
/// Each card taps through to the placed user's profile. Loading shows skeleton
/// rows; empty shows graceful per-lane hints; error offers a retry.
class TopFeedSection extends ConsumerWidget {
  const TopFeedSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final feedAsync = ref.watch(topFeedProvider);

    return GlassCard(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          DashWidgetHeader(
            icon: Icons.emoji_events_rounded,
            title: 'Топ эфира',
            accent: context.colors.warning,
            linkRoute: AppRoutes.top,
            linkLabel: 'Весь Топ',
          ),
          const SizedBox(height: AppSpacing.sm),
          feedAsync.when(
            loading: () => const _MarqueeSkeleton(),
            error: (_, _) => Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
              child: ErrorView(
                title: 'Топ недоступен',
                message: 'Не удалось загрузить ленту.',
                onRetry: () => ref.invalidate(topFeedProvider),
              ),
            ),
            data: (feed) => _FeedBody(feed: feed),
          ),
        ],
      ),
    );
  }
}

class _FeedBody extends StatelessWidget {
  const _FeedBody({required this.feed});

  final TopFeed feed;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (feed.left.isNotEmpty)
          _MarqueeRow(entries: feed.left, reverse: false)
        else
          const _LaneHint(label: 'Верхняя дорожка свободна — займите место!'),
        const SizedBox(height: AppSpacing.md),
        if (feed.right.isNotEmpty)
          _MarqueeRow(entries: feed.right, reverse: true)
        else
          const _LaneHint(label: 'Нижняя дорожка свободна — займите место!'),
        const SizedBox(height: AppSpacing.lg),
        _BuyPlacementBand(occupied: feed.total > 0),
      ],
    );
  }
}

/// A single continuously-scrolling marquee row. Built from an
/// [AnimationController] that advances a horizontal offset across a doubled
/// child list (so the loop is seamless). Pauses while the user is touching it;
/// holds still under reduced-motion.
class _MarqueeRow extends StatefulWidget {
  const _MarqueeRow({required this.entries, required this.reverse});

  final List<TopEntry> entries;

  /// When true the row drifts right→left (the bottom lane); otherwise L→R.
  final bool reverse;

  @override
  State<_MarqueeRow> createState() => _MarqueeRowState();
}

class _MarqueeRowState extends State<_MarqueeRow>
    with SingleTickerProviderStateMixin {
  static const double _cardWidth = 220;
  static const double _gap = AppSpacing.md;
  static const double _pxPerSecond = 26;

  late final AnimationController _controller;
  bool _paused = false;

  @override
  void initState() {
    super.initState();
    // The controller free-runs; its value (0→1) maps to one set's scroll span.
    final spanMs =
        ((_cardWidth + _gap) * widget.entries.length / _pxPerSecond * 1000)
            .round()
            .clamp(4000, 60000);
    _controller = AnimationController(
      vsync: this,
      duration: Duration(milliseconds: spanMs),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _setPaused(bool value) {
    if (value == _paused) return;
    _paused = value;
    if (value) {
      _controller.stop();
    } else {
      _controller.repeat();
    }
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    final setExtent = (_cardWidth + _gap) * widget.entries.length;

    final row = SizedBox(
      height: 64,
      child: ClipRect(
        child: ShaderMask(
          shaderCallback: (bounds) => const LinearGradient(
            begin: Alignment.centerLeft,
            end: Alignment.centerRight,
            colors: [Colors.transparent, Colors.white, Colors.white, Colors.transparent],
            stops: [0, 0.06, 0.94, 1],
          ).createShader(bounds),
          blendMode: BlendMode.dstIn,
          child: reduceMotion
              ? _staticRow()
              : AnimatedBuilder(
                  animation: _controller,
                  builder: (context, _) {
                    final base = _controller.value * setExtent;
                    final dx = widget.reverse ? -(setExtent - base) : -base;
                    return _buildScrollingRow(dx, setExtent);
                  },
                ),
        ),
      ),
    );

    return Listener(
      onPointerDown: (_) => _setPaused(true),
      onPointerUp: (_) => _setPaused(false),
      onPointerCancel: (_) => _setPaused(false),
      child: row,
    );
  }

  /// Render two consecutive copies of the card set, translated by [dx], so the
  /// content scrolls seamlessly. [setExtent] is the width of one copy.
  Widget _buildScrollingRow(double dx, double setExtent) {
    return Transform.translate(
      offset: Offset(dx, 0),
      child: OverflowBox(
        maxWidth: setExtent * 2,
        alignment: Alignment.centerLeft,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (var copy = 0; copy < 2; copy++)
              for (final entry in widget.entries)
                Padding(
                  padding: const EdgeInsets.only(right: _gap),
                  child: SizedBox(
                    width: _cardWidth,
                    child: _TopCard(entry: entry),
                  ),
                ),
          ],
        ),
      ),
    );
  }

  /// Reduced-motion fallback: a plain horizontally-scrollable list.
  Widget _staticRow() {
    return ListView.separated(
      scrollDirection: Axis.horizontal,
      itemCount: widget.entries.length,
      separatorBuilder: (_, _) => const SizedBox(width: _gap),
      itemBuilder: (_, i) => SizedBox(
        width: _cardWidth,
        child: _TopCard(entry: widget.entries[i]),
      ),
    );
  }
}

/// A single Top placement card: rank badge, avatar (ringed for premium),
/// nickname and the coins spent. Taps through to the user's profile.
class _TopCard extends StatelessWidget {
  const _TopCard({required this.entry});

  final TopEntry entry;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final profile = entry.profile;

    return GlassCard(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.sm, vertical: AppSpacing.sm),
      blurSigma: 0,
      onTap: () => context.go(AppRoutes.profileOf(profile.id)),
      child: Row(
        children: [
          NeonAvatar(
            imageUrl: profile.avatarUrl,
            name: profile.nickname,
            size: 40,
            ring: profile.isPremium,
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  profile.nickname,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: context.texts.labelLarge
                      ?.copyWith(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 2),
                Row(
                  children: [
                    Icon(Icons.monetization_on_rounded,
                        size: 13, color: colors.warning),
                    const SizedBox(width: 3),
                    Text(
                      _compact(entry.placement.coinsSpent),
                      style: context.texts.bodySmall?.copyWith(
                        color: context.scheme.onSurfaceVariant,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static String _compact(int value) {
    if (value >= 1000000) {
      return '${(value / 1000000).toStringAsFixed(value % 1000000 == 0 ? 0 : 1)}M';
    }
    if (value >= 1000) {
      return '${(value / 1000).toStringAsFixed(value % 1000 == 0 ? 0 : 1)}k';
    }
    return '$value';
  }
}

class _LaneHint extends StatelessWidget {
  const _LaneHint({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      height: 64,
      alignment: Alignment.center,
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
      decoration: BoxDecoration(
        borderRadius: AppRadii.brXl,
        border: Border.all(color: colors.glassBorder),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Flexible(
            child: Text(
              label,
              textAlign: TextAlign.center,
              style: context.texts.bodySmall
                  ?.copyWith(color: context.scheme.onSurfaceVariant),
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Icon(Icons.arrow_forward_rounded, size: 16, color: colors.neonCyan),
        ],
      ),
    );
  }
}

/// The "buy a placement" CTA band beneath the marquee.
class _BuyPlacementBand extends StatelessWidget {
  const _BuyPlacementBand({required this.occupied});

  final bool occupied;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        borderRadius: AppRadii.brXl,
        border: Border.all(color: colors.warning.withValues(alpha: 0.24)),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            colors.warning.withValues(alpha: 0.18),
            colors.neonMagenta.withValues(alpha: 0.10),
            colors.neonViolet.withValues(alpha: 0.16),
          ],
        ),
        boxShadow: AppShadows.glow(colors.warning, strength: 0.28),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  borderRadius: AppRadii.brMd,
                  gradient: LinearGradient(
                    colors: [colors.warning, colors.neonMagenta],
                  ),
                  boxShadow: AppShadows.glow(colors.warning, strength: 0.4),
                ),
                child: const Icon(Icons.emoji_events_rounded,
                    size: 20, color: Colors.white),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Хотите оказаться здесь?',
                        style: context.texts.titleMedium),
                    const SizedBox(height: 2),
                    Text(
                      occupied
                          ? 'Сделайте ставку выше — и поднимитесь в начало ленты.'
                          : 'Дорожки свободны — станьте первым в Топе.',
                      style: context.texts.bodySmall
                          ?.copyWith(color: context.scheme.onSurfaceVariant),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          GradientButton(
            label: 'Купить место в Топе',
            icon: Icons.emoji_events_rounded,
            gradientColors: [colors.warning, colors.neonMagenta],
            height: 46,
            onPressed: () => context.go(AppRoutes.top),
          ),
        ],
      ),
    );
  }
}

class _MarqueeSkeleton extends StatelessWidget {
  const _MarqueeSkeleton();

  @override
  Widget build(BuildContext context) {
    Widget row() => SizedBox(
          height: 64,
          child: LoadingShimmer(
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: 4,
              separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.md),
              itemBuilder: (_, _) => const SizedBox(
                width: 220,
                child: _CardSkeleton(),
              ),
            ),
          ),
        );

    return Column(
      children: [
        row(),
        const SizedBox(height: AppSpacing.md),
        row(),
      ],
    );
  }
}

class _CardSkeleton extends StatelessWidget {
  const _CardSkeleton();

  @override
  Widget build(BuildContext context) {
    return GlassCard(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.sm, vertical: AppSpacing.sm),
      blurSigma: 0,
      child: Row(
        children: const [
          ShimmerBox(height: 40, shape: BoxShape.circle),
          SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                ShimmerBox(width: 90, height: 12),
                SizedBox(height: 6),
                ShimmerBox(width: 50, height: 10),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
