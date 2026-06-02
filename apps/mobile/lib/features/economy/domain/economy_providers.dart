import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/models.dart';
import '../data/economy_repository.dart';

/// ─────────────────────────────────────────────────────────────────────────
/// Economy read providers.
///
/// Screens `ref.watch` these AsyncValue providers and render loading / error /
/// data with the shared widget kit. Mutations (buy coins, send gift, purchase
/// Top, subscribe) live in their own controllers and `ref.invalidate` the
/// relevant provider on success.
/// ─────────────────────────────────────────────────────────────────────────

/// `GET /wallet` — the caller's coin balance. Refreshable after a purchase
/// (the credit lands via the CloudPayments webhook; we re-fetch to observe it).
final walletProvider = FutureProvider.autoDispose<Wallet>((ref) async {
  // Keep the balance warm briefly so quick screen hops don't refetch.
  final link = ref.keepAlive();
  final timer = Future<void>.delayed(const Duration(seconds: 30), link.close);
  ref.onDispose(() => timer.ignore());
  return ref.watch(economyRepositoryProvider).wallet();
});

/// Convenience: the current balance as a plain int (or `null` while loading).
final coinBalanceProvider = Provider.autoDispose<int?>((ref) {
  return ref.watch(walletProvider).value?.balanceCoins;
});

/// `GET /coin-packages` — purchasable coin bundles (kept alive: static catalog).
final coinPackagesProvider = FutureProvider<List<CoinPackage>>((ref) {
  return ref.watch(economyRepositoryProvider).coinPackages();
});

/// Index of the lowest price-per-coin package (the "best value" highlight), or
/// `-1` when the catalog is empty/loading.
final bestPackageIndexProvider = Provider<int>((ref) {
  final packages = ref.watch(coinPackagesProvider).value;
  if (packages == null || packages.isEmpty) return -1;
  var best = 0;
  var bestPpc = double.infinity;
  for (var i = 0; i < packages.length; i++) {
    final p = packages[i];
    final total = p.coins + p.bonusCoins;
    final ppc = total > 0 ? p.priceRub / total : double.infinity;
    if (ppc < bestPpc) {
      bestPpc = ppc;
      best = i;
    }
  }
  return best;
});

/// `GET /gifts` — the gift catalog (kept alive: static catalog).
final giftsProvider = FutureProvider<List<Gift>>((ref) {
  return ref.watch(economyRepositoryProvider).gifts();
});

/// A rarity bucket (legendary → common ordering preserved by the list order).
class GiftRarityGroup {
  const GiftRarityGroup({required this.rarity, required this.gifts});
  final Rarity rarity;
  final List<Gift> gifts;
}

/// Gifts grouped by rarity, ordered legendary → epic → rare → common (mirrors
/// the web's `useGiftsByRarity`). Empty buckets are dropped.
final giftsByRarityProvider = Provider<List<GiftRarityGroup>>((ref) {
  final gifts = ref.watch(giftsProvider).value;
  if (gifts == null || gifts.isEmpty) return const [];
  const order = [Rarity.legendary, Rarity.epic, Rarity.rare, Rarity.common];
  final groups = <GiftRarityGroup>[];
  for (final rarity in order) {
    final list = gifts.where((g) => g.rarity == rarity).toList(growable: false);
    if (list.isNotEmpty) {
      groups.add(GiftRarityGroup(rarity: rarity, gifts: list));
    }
  }
  return groups;
});

/// The Top feed split into its two lanes, each sorted by priority (descending —
/// higher bid first), mirroring the web's `useTopFeed`.
class TopFeed {
  const TopFeed({required this.left, required this.right});
  final List<TopPlacement> left;
  final List<TopPlacement> right;

  int get total => left.length + right.length;

  static const empty = TopFeed(left: [], right: []);
}

/// `GET /top` — the current Top placements, bucketed by lane.
final topFeedProvider = FutureProvider.autoDispose<TopFeed>((ref) async {
  final placements = await ref.watch(economyRepositoryProvider).topFeed();
  int byPriority(TopPlacement a, TopPlacement b) => b.priority.compareTo(a.priority);
  final left = placements.where((p) => p.lane == TopLane.left).toList()..sort(byPriority);
  final right = placements.where((p) => p.lane == TopLane.right).toList()..sort(byPriority);
  return TopFeed(left: left, right: right);
});

/// `GET /premium/plans` — subscription tiers (kept alive: static catalog).
final premiumPlansProvider = FutureProvider<List<PremiumPlan>>((ref) {
  return ref.watch(economyRepositoryProvider).premiumPlans();
});

/// Cursor-paginated coin ledger (`GET /wallet/transactions`) with incremental
/// loading. The state is the accumulated list plus paging metadata.
class TransactionsState {
  const TransactionsState({
    this.items = const [],
    this.nextCursor,
    this.hasMore = false,
    this.isLoadingMore = false,
  });

  final List<CoinTransaction> items;
  final String? nextCursor;
  final bool hasMore;
  final bool isLoadingMore;

  TransactionsState copyWith({
    List<CoinTransaction>? items,
    String? nextCursor,
    bool? hasMore,
    bool? isLoadingMore,
  }) =>
      TransactionsState(
        items: items ?? this.items,
        nextCursor: nextCursor,
        hasMore: hasMore ?? this.hasMore,
        isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      );
}

/// AsyncNotifier for the paginated transaction ledger. `build` loads page one;
/// [loadMore] appends the next cursor page; [refresh] reloads from scratch.
class TransactionsNotifier
    extends AsyncNotifier<TransactionsState> {
  static const _pageSize = 30;

  @override
  Future<TransactionsState> build() async {
    final page = await ref
        .watch(economyRepositoryProvider)
        .transactions(limit: _pageSize);
    return TransactionsState(
      items: page.items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    );
  }

  /// Append the next page, if any. No-op while already loading or exhausted.
  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || !current.hasMore || current.isLoadingMore) return;
    state = AsyncData(current.copyWith(isLoadingMore: true));
    try {
      final page = await ref.read(economyRepositoryProvider).transactions(
            cursor: current.nextCursor,
            limit: _pageSize,
          );
      state = AsyncData(
        current.copyWith(
          items: [...current.items, ...page.items],
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          isLoadingMore: false,
        ),
      );
    } catch (_) {
      // Surface a non-fatal failure by clearing the loading flag; the list
      // stays usable and the user can retry the "load more" affordance.
      state = AsyncData(current.copyWith(isLoadingMore: false));
    }
  }

  /// Reload page one (e.g. pull-to-refresh, or after a coin-spending action).
  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(build);
  }
}

final transactionsProvider =
    AsyncNotifierProvider.autoDispose<TransactionsNotifier, TransactionsState>(
  TransactionsNotifier.new,
);
