import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/models/models.dart';
import '../../../core/router/routes.dart';
import '../../../core/theme/theme.dart';
import '../../../core/widgets/widgets.dart';
import '../../dashboard/presentation/dashboard_providers.dart' show presenceProvider;
import '../domain/search_controller.dart';
import 'widgets/person_card.dart';
import 'widgets/search_filter_bar.dart';

/// `/search` — people discovery.
///
/// A debounced search field over `GET /profiles/search` with gender / country
/// facets and an "online" toggle, rendering a responsive grid of [PersonCard]s
/// that tap through to the public profile. Results paginate by cursor as the
/// user scrolls; loading / empty / error states are handled per the shared kit.
class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key});

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  final ScrollController _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
    // As results arrive, subscribe their presence so the "online" filter (and
    // the avatar dots) reflect live status — same mechanism as the dashboard.
    ref.listenManual<AsyncValue<SearchState>>(searchResultsProvider, (prev, next) {
      final items = next.value?.items;
      if (items == null || items.isEmpty) return;
      final ids = items.map((p) => p.id).toList(growable: false);
      ref.read(presenceProvider.notifier).seed(const <String, OnlineStatus>{}, ids);
    });
  }

  @override
  void dispose() {
    _scroll.removeListener(_onScroll);
    _scroll.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scroll.position.pixels >= _scroll.position.maxScrollExtent - 480) {
      ref.read(searchResultsProvider.notifier).loadMore();
    }
  }

  @override
  Widget build(BuildContext context) {
    final filters = ref.watch(searchFiltersProvider);
    final resultsAsync = ref.watch(searchResultsProvider);

    return AppScaffold(
      title: 'Поиск',
      currentRoute: AppRoutes.search,
      body: Column(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(
                AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.sm),
            child: SearchFilterBar(),
          ),
          Expanded(
            child: _Results(
              filters: filters,
              results: resultsAsync,
              scrollController: _scroll,
            ),
          ),
        ],
      ),
    );
  }
}

/// Switches between the idle hint, the loading shimmer, the populated grid and
/// the empty / error states, applying the client-side "online" filter on top of
/// the server results.
class _Results extends ConsumerWidget {
  const _Results({
    required this.filters,
    required this.results,
    required this.scrollController,
  });

  final SearchFilters filters;
  final AsyncValue<SearchState> results;
  final ScrollController scrollController;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Idle: no query and no server facet selected yet.
    if (!filters.hasServerCriteria) {
      return const _IdleHint();
    }

    // First load (no prior data) → full skeleton; a refetch over existing
    // results keeps the grid visible with a thin progress bar on top.
    final state = results.value;
    if (state == null) {
      if (results.hasError) {
        return ErrorView(
          title: 'Не удалось выполнить поиск',
          message: 'Попробуйте ещё раз чуть позже.',
          onRetry: () => ref.invalidate(searchResultsProvider),
        );
      }
      return const _GridSkeleton();
    }

    // Watch the live presence map once (drives both the "online" filter and the
    // per-card status dot) — never `ref.watch` inside the lazy builder.
    final presence = ref.watch(presenceProvider);
    final people = filters.onlineOnly
        ? _applyOnlineFilter(state.items, presence)
        : state.items;

    final grid = people.isEmpty
        ? _EmptyResults(filters: filters)
        : GridView.builder(
            controller: scrollController,
            padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, AppSpacing.xxxl),
            gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
              maxCrossAxisExtent: 260,
              mainAxisExtent: 196,
              crossAxisSpacing: AppSpacing.md,
              mainAxisSpacing: AppSpacing.md,
            ),
            // One trailing slot for the "load more" footer when paging.
            itemCount: people.length + (state.isLoadingMore ? 1 : 0),
            itemBuilder: (context, i) {
              if (i >= people.length) return const _LoadMoreTile();
              final profile = people[i];
              return PersonCard(
                profile: profile,
                status: presence[profile.id],
                onTap: () => context.go(AppRoutes.profileOf(profile.id)),
              );
            },
          );

    // A subtle top progress strip while a new query is loading over old results.
    return Column(
      children: [
        SizedBox(
          height: 2,
          child: results.isLoading
              ? LinearProgressIndicator(
                  minHeight: 2,
                  backgroundColor: Colors.transparent,
                  valueColor:
                      AlwaysStoppedAnimation(context.colors.neonViolet),
                )
              : null,
        ),
        Expanded(child: grid),
      ],
    );
  }

  static List<PublicProfile> _applyOnlineFilter(
    List<PublicProfile> items,
    Map<String, OnlineStatus> presence,
  ) {
    const live = {OnlineStatus.online, OnlineStatus.away, OnlineStatus.inCall};
    return items
        .where((p) => live.contains(presence[p.id] ?? OnlineStatus.offline))
        .toList(growable: false);
  }
}

/// The pre-search state: a friendly nudge explaining how to discover people.
class _IdleHint extends StatelessWidget {
  const _IdleHint();

  @override
  Widget build(BuildContext context) {
    return const EmptyState(
      icon: Icons.travel_explore_rounded,
      title: 'Найдите собеседника',
      message:
          'Введите имя пользователя или выберите фильтры по полу и стране, '
          'чтобы найти людей. Открывайте профили и добавляйтесь в друзья.',
    );
  }
}

/// Empty result set — copy adapts to whether filters are narrowing it.
class _EmptyResults extends ConsumerWidget {
  const _EmptyResults({required this.filters});

  final SearchFilters filters;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final narrowed = filters.onlineOnly ||
        filters.gender != null ||
        (filters.country != null && filters.country!.isNotEmpty);

    return EmptyState(
      icon: Icons.person_search_rounded,
      title: narrowed ? 'Под фильтры никто не подходит' : 'Никого не нашлось',
      message: narrowed
          ? 'Попробуйте смягчить фильтры по полу, стране или статусу.'
          : 'Проверьте имя пользователя и попробуйте снова.',
      actionLabel: narrowed ? 'Сбросить фильтры' : null,
      onAction: narrowed
          ? () => ref.read(searchFiltersProvider.notifier).reset()
          : null,
    );
  }
}

/// Trailing footer tile shown while the next cursor page loads.
class _LoadMoreTile extends StatelessWidget {
  const _LoadMoreTile();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: SizedBox(
          height: 26,
          width: 26,
          child: CircularProgressIndicator(
            strokeWidth: 2.4,
            valueColor: AlwaysStoppedAnimation(context.colors.neonViolet),
          ),
        ),
      ),
    );
  }
}

/// A grid of shimmering placeholder cards while the first page loads.
class _GridSkeleton extends StatelessWidget {
  const _GridSkeleton();

  @override
  Widget build(BuildContext context) {
    return LoadingShimmer(
      child: GridView.builder(
        padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, AppSpacing.xxxl),
        physics: const NeverScrollableScrollPhysics(),
        itemCount: 6,
        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
          maxCrossAxisExtent: 260,
          mainAxisExtent: 196,
          crossAxisSpacing: AppSpacing.md,
          mainAxisSpacing: AppSpacing.md,
        ),
        itemBuilder: (_, _) => Container(
          decoration: BoxDecoration(
            color: context.scheme.surfaceContainerHighest,
            borderRadius: AppRadii.brXl,
          ),
        ),
      ),
    );
  }
}
