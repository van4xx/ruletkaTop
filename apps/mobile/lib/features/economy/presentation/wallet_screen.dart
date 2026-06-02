import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/routes.dart';
import '../../../core/theme/theme.dart';
import '../../../core/widgets/widgets.dart';
import '../domain/economy_providers.dart';
import 'widgets/balance_hero.dart';
import 'widgets/transaction_tile.dart';
import 'widgets/wallet_stats.dart';

/// `/wallet` — the account view: live balance, a derived stats strip and the
/// complete, cursor-paginated coin ledger. A "Пополнить" CTA jumps to the coin
/// storefront (`/coins`).
class WalletScreen extends ConsumerStatefulWidget {
  const WalletScreen({super.key});

  @override
  ConsumerState<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends ConsumerState<WalletScreen> {
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController
      ..removeListener(_onScroll)
      ..dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 400) {
      ref.read(transactionsProvider.notifier).loadMore();
    }
  }

  @override
  Widget build(BuildContext context) {
    final wallet = ref.watch(walletProvider);
    final tx = ref.watch(transactionsProvider);
    final txState = tx.value;
    final items = txState?.items ?? const [];

    return AppScaffold(
      title: 'Кошелёк',
      showWordmark: false,
      currentRoute: null,
      actions: [
        IconButton(
          tooltip: 'Магазин монет',
          icon: const Icon(Icons.shopping_bag_outlined),
          onPressed: () => context.go(AppRoutes.coins),
        ),
      ],
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(walletProvider);
          await ref.read(transactionsProvider.notifier).refresh();
        },
        child: CustomScrollView(
          controller: _scrollController,
          slivers: [
            SliverPadding(
              padding: AppSpacing.page,
              sliver: SliverList.list(
                children: [
                  BalanceHero(
                    balance: wallet.value?.balanceCoins,
                    isLoading: wallet.isLoading,
                    isError: wallet.hasError,
                    onTopUp: () => context.go(AppRoutes.coins),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  WalletStats(transactions: items, isLoading: tx.isLoading),
                  const SizedBox(height: AppSpacing.xl),
                  const SectionHeader(title: 'История операций'),
                  const SizedBox(height: AppSpacing.xs),
                ],
              ),
            ),

            // Ledger body.
            if (tx.isLoading)
              SliverToBoxAdapter(
                child: LoadingShimmer.list(items: 8),
              )
            else if (tx.hasError)
              SliverFillRemaining(
                hasScrollBody: false,
                child: ErrorView(
                  title: 'Не удалось загрузить историю',
                  message: 'Лента операций временно недоступна.',
                  onRetry: () => ref.read(transactionsProvider.notifier).refresh(),
                ),
              )
            else if (items.isEmpty)
              SliverFillRemaining(
                hasScrollBody: false,
                child: EmptyState(
                  icon: Icons.account_balance_wallet_outlined,
                  title: 'Пока нет операций',
                  message: 'Пополните баланс, чтобы начать дарить подарки и покупать места в Топе.',
                  actionLabel: 'Пополнить',
                  onAction: () => context.go(AppRoutes.coins),
                ),
              )
            else
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(
                    AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.lg),
                sliver: SliverList.separated(
                  itemCount: items.length + ((txState?.hasMore ?? false) ? 1 : 0),
                  separatorBuilder: (_, _) =>
                      Divider(height: 1, color: context.colors.glassBorder),
                  itemBuilder: (context, i) {
                    if (i >= items.length) {
                      return const Padding(
                        padding: EdgeInsets.all(AppSpacing.lg),
                        child: Center(
                          child: SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(strokeWidth: 2.4),
                          ),
                        ),
                      );
                    }
                    return TransactionTile(tx: items[i]);
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}
