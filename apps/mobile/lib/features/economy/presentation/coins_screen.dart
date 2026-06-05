import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/routes.dart';
import '../../../core/theme/theme.dart';
import '../../../core/widgets/widgets.dart';
import '../domain/buy_coins_controller.dart';
import '../domain/economy_providers.dart';
import 'widgets/balance_hero.dart';
import 'widgets/checkout_status_dialog.dart';
import 'widgets/coin_package_card.dart';
import 'widgets/transaction_tile.dart';

/// `/coins` — the coin storefront: live balance, package grid (buy via the
/// CloudPayments WebView) and a recent-operations preview. The buy flow never
/// touches card data (see [BuyCoinsController]).
class CoinsScreen extends ConsumerWidget {
  const CoinsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Surface the tail of the purchase flow as a status dialog.
    ref.listen<BuyCoinsState>(buyCoinsControllerProvider, (prev, next) {
      final wasVisible =
          prev != null && CheckoutStatusDialog.isVisibleFor(prev.phase);
      final isVisible = CheckoutStatusDialog.isVisibleFor(next.phase);
      if (isVisible && !wasVisible) _showStatusDialog(context, ref);
    });

    final wallet = ref.watch(walletProvider);
    final transactions = ref.watch(transactionsProvider);
    final buyState = ref.watch(buyCoinsControllerProvider);

    return AppScaffold(
      title: 'Монеты',
      currentRoute: null,
      actions: [
        IconButton(
          tooltip: 'Кошелёк',
          icon: const Icon(Icons.account_balance_wallet_outlined),
          onPressed: () => context.push(AppRoutes.wallet),
        ),
      ],
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(walletProvider);
          ref.invalidate(coinPackagesProvider);
          await ref.read(transactionsProvider.notifier).refresh();
        },
        child: ListView(
          padding: AppSpacing.page,
          children: [
            const _Eyebrow(
              icon: Icons.shopping_bag_rounded,
              label: 'Магазин монет',
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'Монеты для подарков и Топа',
              style: AppTypography.display(
                fontSize: 26,
                color: context.scheme.onSurface,
              ),
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Пополняйте баланс, чтобы дарить подарки, покупать места в Топе и открывать больше возможностей.',
              style: context.texts.bodyMedium?.copyWith(
                color: context.scheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: AppSpacing.xl),

            // Balance hero.
            BalanceHero(
              balance: wallet.value?.balanceCoins,
              isLoading: wallet.isLoading,
              isError: wallet.hasError,
            ),
            const SizedBox(height: AppSpacing.xl),

            // Packages.
            const SectionHeader(title: 'Выберите пакет'),
            const SizedBox(height: AppSpacing.sm),
            _PackagesGrid(buyState: buyState),
            const SizedBox(height: AppSpacing.xl),

            // Recent operations preview.
            SectionHeader(
              title: 'История операций',
              trailing: TextButton(
                onPressed: () => context.push(AppRoutes.wallet),
                child: const Text('Все'),
              ),
            ),
            const SizedBox(height: AppSpacing.xs),
            _RecentTransactions(state: transactions),
            const SizedBox(height: AppSpacing.xl),
          ],
        ),
      ),
    );
  }

  void _showStatusDialog(BuildContext context, WidgetRef ref) {
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) {
        return Consumer(
          builder: (ctx, dialogRef, _) {
            final state = dialogRef.watch(buyCoinsControllerProvider);
            // Auto-dismiss once the flow leaves a terminal phase.
            if (!CheckoutStatusDialog.isVisibleFor(state.phase)) {
              return const SizedBox.shrink();
            }
            return CheckoutStatusDialog(
              phase: state.phase,
              package: state.activePackage,
              error: state.error,
              onClose: () {
                Navigator.of(dialogContext).pop();
                dialogRef.read(buyCoinsControllerProvider.notifier).reset();
              },
              onRetry: () {
                final pkg = state.activePackage;
                Navigator.of(dialogContext).pop();
                final notifier = dialogRef.read(
                  buyCoinsControllerProvider.notifier,
                );
                notifier.reset();
                if (pkg != null) notifier.buy(context, pkg);
              },
            );
          },
        );
      },
    );
  }
}

class _PackagesGrid extends ConsumerWidget {
  const _PackagesGrid({required this.buyState});

  final BuyCoinsState buyState;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final packages = ref.watch(coinPackagesProvider);
    final bestIndex = ref.watch(bestPackageIndexProvider);

    return packages.when(
      loading: () => const _GridSkeleton(),
      error: (_, _) => ErrorView(
        title: 'Не удалось загрузить пакеты',
        message: 'Каталог монет временно недоступен.',
        onRetry: () => ref.invalidate(coinPackagesProvider),
      ),
      data: (list) {
        if (list.isEmpty) {
          return const EmptyState(
            icon: Icons.shopping_bag_outlined,
            title: 'Пакеты недоступны',
            message: 'Загляните позже.',
          );
        }
        return GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: list.length,
          gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
            maxCrossAxisExtent: 220,
            mainAxisExtent: 188,
            crossAxisSpacing: AppSpacing.md,
            mainAxisSpacing: AppSpacing.md,
          ),
          itemBuilder: (context, i) {
            final pkg = list[i];
            return CoinPackageCard(
              package: pkg,
              best: i == bestIndex,
              loading:
                  buyState.isBusy && buyState.activePackage?.code == pkg.code,
              disabled: buyState.isBusy,
              onBuy: () => ref
                  .read(buyCoinsControllerProvider.notifier)
                  .buy(context, pkg),
            );
          },
        );
      },
    );
  }
}

class _RecentTransactions extends StatelessWidget {
  const _RecentTransactions({required this.state});

  final AsyncValue<TransactionsState> state;

  @override
  Widget build(BuildContext context) {
    return state.when(
      loading: () => LoadingShimmer.list(items: 3, padding: EdgeInsets.zero),
      error: (_, _) => Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
        child: Text(
          'Не удалось загрузить историю',
          style: context.texts.bodyMedium?.copyWith(
            color: context.scheme.onSurfaceVariant,
          ),
        ),
      ),
      data: (data) {
        if (data.items.isEmpty) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
            child: Text(
              'Пока нет операций — пополните баланс, чтобы начать.',
              style: context.texts.bodyMedium?.copyWith(
                color: context.scheme.onSurfaceVariant,
              ),
            ),
          );
        }
        final preview = data.items.take(5).toList();
        return GlassCard(
          borderRadius: AppRadii.brXxl,
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg,
            vertical: AppSpacing.sm,
          ),
          child: Column(
            children: [
              for (var i = 0; i < preview.length; i++) ...[
                if (i > 0)
                  Divider(height: 1, color: context.colors.glassBorder),
                TransactionTile(tx: preview[i]),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _Eyebrow extends StatelessWidget {
  const _Eyebrow({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Row(
      children: [
        Icon(icon, size: 16, color: colors.warning),
        const SizedBox(width: AppSpacing.xs),
        Text(
          label.toUpperCase(),
          style: AppTypography.eyebrow(fontSize: 11, color: colors.warning),
        ),
      ],
    );
  }
}

class _GridSkeleton extends StatelessWidget {
  const _GridSkeleton();

  @override
  Widget build(BuildContext context) {
    return LoadingShimmer(
      child: GridView.builder(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: 4,
        gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
          maxCrossAxisExtent: 220,
          mainAxisExtent: 188,
          crossAxisSpacing: AppSpacing.md,
          mainAxisSpacing: AppSpacing.md,
        ),
        itemBuilder: (_, _) => Container(
          decoration: BoxDecoration(
            color: context.scheme.surfaceContainerHighest,
            borderRadius: AppRadii.brXxl,
          ),
        ),
      ),
    );
  }
}
