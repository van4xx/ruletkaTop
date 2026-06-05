import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/di.dart';
import '../../../core/models/models.dart';
import '../../../core/router/routes.dart';
import '../../../core/theme/theme.dart';
import '../../../core/widgets/widgets.dart';
import '../domain/leaderboard_controller.dart';
import 'leaderboard_format.dart';
import 'widgets/leaderboard_podium.dart';
import 'widgets/leaderboard_row.dart';

/// `/leaderboard` — «Лидеры»: a ranking of users by a derivable metric.
///
/// Three metric tabs (подарки / монеты / Топ) each load their own family-keyed
/// ranking. The top-3 render as a neon podium, the remainder as a numbered
/// list, and the caller's own rank is highlighted (pinned below the list when
/// outside the returned slice). Loading / empty / error use the shared kit.
class LeaderboardScreen extends ConsumerStatefulWidget {
  const LeaderboardScreen({super.key});

  @override
  ConsumerState<LeaderboardScreen> createState() => _LeaderboardScreenState();
}

class _LeaderboardScreenState extends ConsumerState<LeaderboardScreen>
    with SingleTickerProviderStateMixin {
  static const _metrics = LeaderboardMetric.values;

  late final TabController _tabs =
      TabController(length: _metrics.length, vsync: this)
        ..addListener(_onTabChanged);

  LeaderboardMetric get _metric => _metrics[_tabs.index];

  @override
  void dispose() {
    _tabs
      ..removeListener(_onTabChanged)
      ..dispose();
    super.dispose();
  }

  void _onTabChanged() {
    // Rebuild on settle so the watched family key follows the active tab.
    if (!_tabs.indexIsChanging) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final metric = _metric;
    final async = ref.watch(leaderboardControllerProvider(metric));
    final selfId = ref.watch(currentUserIdProvider);

    return AppScaffold(
      title: 'Лидеры',
      currentRoute: AppRoutes.leaderboard,
      bottom: TabBar(
        controller: _tabs,
        isScrollable: false,
        tabs: [
          for (final m in _metrics) Tab(text: LeaderboardFormat.metricLabel(m)),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () =>
            ref.read(leaderboardControllerProvider(metric).notifier).refresh(),
        child: async.when(
          loading: () => LoadingShimmer.list(items: 8),
          error: (_, _) => _ScrollableFill(
            child: ErrorView(
              title: 'Не удалось загрузить',
              message: 'Таблица лидеров временно недоступна.',
              onRetry: () => ref
                  .read(leaderboardControllerProvider(metric).notifier)
                  .refresh(),
            ),
          ),
          data: (res) => _LeaderboardBody(
            response: res,
            metric: metric,
            selfId: selfId,
            onTapUser: (id) => context.push(AppRoutes.profileOf(id)),
          ),
        ),
      ),
    );
  }
}

class _LeaderboardBody extends StatelessWidget {
  const _LeaderboardBody({
    required this.response,
    required this.metric,
    required this.selfId,
    required this.onTapUser,
  });

  final LeaderboardResponse response;
  final LeaderboardMetric metric;
  final String? selfId;
  final void Function(String userId) onTapUser;

  @override
  Widget build(BuildContext context) {
    final entries = response.entries;
    if (entries.isEmpty) {
      return _ScrollableFill(
        child: EmptyState(
          icon: Icons.leaderboard_rounded,
          title: 'Пока пусто',
          message: LeaderboardFormat.emptyHint(metric),
        ),
      );
    }

    final podium = entries.take(3).toList();
    final rest = entries.length > 3 ? entries.sublist(3) : const <LeaderboardEntry>[];

    // The caller's own row: prefer the server-provided `me` (when they're
    // outside the returned slice), else detect them inside the slice.
    final inSlice = selfId != null && entries.any((e) => e.userId == selfId);
    final me = response.me;

    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.xxxl),
      children: [
        LeaderboardPodium(
          entries: podium,
          metric: metric,
          selfId: selfId,
          onTapUser: onTapUser,
        ),
        if (rest.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.xl),
          const SectionHeader(title: 'Рейтинг'),
          const SizedBox(height: AppSpacing.xs),
          for (final e in rest) ...[
            LeaderboardRow(
              entry: e,
              metric: metric,
              isSelf: selfId != null && e.userId == selfId,
              onTap: () => onTapUser(e.userId),
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
        ],
        // Pin the caller's rank when they're not already shown above.
        if (me != null && !inSlice) ...[
          const SizedBox(height: AppSpacing.lg),
          const _SelfDivider(),
          const SizedBox(height: AppSpacing.sm),
          LeaderboardRow(
            entry: me,
            metric: metric,
            isSelf: true,
            onTap: () => onTapUser(me.userId),
          ),
        ],
      ],
    );
  }
}

/// A small "ваше место" label separating the pinned own-rank row.
class _SelfDivider extends StatelessWidget {
  const _SelfDivider();

  @override
  Widget build(BuildContext context) {
    final color = context.scheme.onSurfaceVariant;
    return Row(
      children: [
        Expanded(child: Divider(color: context.colors.glassBorder)),
        const SizedBox(width: AppSpacing.sm),
        Text('Ваше место',
            style: context.texts.labelSmall?.copyWith(color: color)),
        const SizedBox(width: AppSpacing.sm),
        Expanded(child: Divider(color: context.colors.glassBorder)),
      ],
    );
  }
}

/// Keeps centered states pull-to-refreshable even when short.
class _ScrollableFill extends StatelessWidget {
  const _ScrollableFill({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: constraints.maxHeight),
          child: child,
        ),
      ),
    );
  }
}
