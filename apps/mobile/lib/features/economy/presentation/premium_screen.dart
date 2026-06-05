import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/models.dart';
import '../../../core/theme/theme.dart';
import '../../../core/widgets/widgets.dart';
import '../domain/economy_providers.dart';
import '../domain/premium_controller.dart';
import 'economy_format.dart';
import 'widgets/premium_plan_card.dart';

/// `/premium` — the subscription storefront: current status, plan tiers, the
/// subscribe flow (recurrent CloudPayments charge) and cancel-at-period-end.
class PremiumScreen extends ConsumerWidget {
  const PremiumScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.listen<PremiumState>(premiumControllerProvider, (prev, next) {
      if (next.phase == SubscribePhase.active &&
          prev?.phase != SubscribePhase.active) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Подписка оформлена! Премиум активируется после оплаты.',
            ),
          ),
        );
        ref.read(premiumControllerProvider.notifier).reset();
      } else if (next.phase == SubscribePhase.error && next.error != null) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(next.error!)));
        ref.read(premiumControllerProvider.notifier).reset();
      }
    });

    final plans = ref.watch(premiumPlansProvider);
    final subscription = ref.watch(subscriptionProvider).value;
    final premiumState = ref.watch(premiumControllerProvider);

    return AppScaffold(
      title: 'Премиум',
      currentRoute: null,
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(premiumPlansProvider);
          ref.invalidate(subscriptionProvider);
        },
        child: ListView(
          padding: AppSpacing.page,
          children: [
            _Hero(subscription: subscription),
            const SizedBox(height: AppSpacing.xl),
            if (subscription != null &&
                subscription.status != SubscriptionStatus.none)
              _CurrentSubscriptionCard(subscription: subscription),
            const _PerksHighlights(),
            const SizedBox(height: AppSpacing.xl),
            const SectionHeader(title: 'Выберите план'),
            const SizedBox(height: AppSpacing.sm),
            plans.when(
              loading: () =>
                  LoadingShimmer.list(items: 2, padding: EdgeInsets.zero),
              error: (_, _) => ErrorView(
                title: 'Не удалось загрузить планы',
                message: 'Тарифы временно недоступны.',
                onRetry: () => ref.invalidate(premiumPlansProvider),
              ),
              data: (list) {
                if (list.isEmpty) {
                  return const EmptyState(
                    icon: Icons.workspace_premium_outlined,
                    title: 'Планы недоступны',
                    message: 'Загляните позже.',
                  );
                }
                // Feature the plan with the longest interval (best value).
                var featuredIdx = 0;
                for (var i = 1; i < list.length; i++) {
                  if (list[i].intervalDays > list[featuredIdx].intervalDays) {
                    featuredIdx = i;
                  }
                }
                return Column(
                  children: [
                    for (var i = 0; i < list.length; i++) ...[
                      if (i > 0) const SizedBox(height: AppSpacing.md),
                      PremiumPlanCard(
                        plan: list[i],
                        featured: i == featuredIdx,
                        isCurrent:
                            subscription?.status == SubscriptionStatus.active &&
                            subscription?.plan == list[i].code,
                        loading:
                            premiumState.isBusy &&
                            premiumState.activePlan?.code == list[i].code,
                        disabled: premiumState.isBusy,
                        onSubscribe: () => ref
                            .read(premiumControllerProvider.notifier)
                            .subscribe(context, list[i]),
                      ),
                    ],
                  ],
                );
              },
            ),
            const SizedBox(height: AppSpacing.xl),
          ],
        ),
      ),
    );
  }
}

class _Hero extends StatelessWidget {
  const _Hero({required this.subscription});

  final Subscription? subscription;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final isActive = subscription?.status == SubscriptionStatus.active;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(
              Icons.workspace_premium_rounded,
              size: 15,
              color: colors.warning,
            ),
            const SizedBox(width: AppSpacing.xs),
            Text(
              'ПРЕМИУМ',
              style: AppTypography.eyebrow(fontSize: 11, color: colors.warning),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.md),
        Container(
          width: 60,
          height: 60,
          decoration: BoxDecoration(
            borderRadius: AppRadii.brXl,
            gradient: LinearGradient(colors: colors.brandGradient),
            boxShadow: AppShadows.glow(colors.neonViolet, strength: 0.7),
          ),
          child: const Icon(
            Icons.workspace_premium_rounded,
            color: Colors.white,
            size: 32,
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        ShaderMask(
          shaderCallback: (b) =>
              LinearGradient(colors: colors.brandGradient).createShader(b),
          child: Text(
            isActive ? 'Вы — премиум' : 'Откройте премиум',
            style: AppTypography.display(fontSize: 28, color: Colors.white),
          ),
        ),
        const SizedBox(height: AppSpacing.xs),
        Text(
          'Больше возможностей: приоритет в поиске, эксклюзивные подарки, продвинутые фильтры и никакой рекламы.',
          style: context.texts.bodyMedium?.copyWith(
            color: context.scheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

/// A 2x2 strip of premium perk highlights (mirrors the web's HIGHLIGHTS grid).
class _PerksHighlights extends StatelessWidget {
  const _PerksHighlights();

  static const _items = [
    (Icons.tune_rounded, 'Фильтры', 'Поиск по интересам и стране'),
    (Icons.block_rounded, 'Без рекламы', 'Чистый интерфейс'),
    (Icons.bolt_rounded, 'Приоритет', 'Выше в подборе собеседников'),
    (Icons.auto_awesome_rounded, 'Статус', 'Премиум-значок и кольцо'),
  ];

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: _items.length,
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 220,
        mainAxisExtent: 124,
        crossAxisSpacing: AppSpacing.md,
        mainAxisSpacing: AppSpacing.md,
      ),
      itemBuilder: (context, i) {
        final (icon, title, text) = _items[i];
        final colors = context.colors;
        return GlassCard(
          borderRadius: AppRadii.brXl,
          padding: const EdgeInsets.all(AppSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  borderRadius: AppRadii.brMd,
                  color: colors.neonViolet.withValues(alpha: 0.14),
                ),
                child: Icon(icon, size: 19, color: colors.neonViolet),
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                title,
                style: context.texts.titleSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                text,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: context.texts.bodySmall?.copyWith(
                  color: context.scheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _CurrentSubscriptionCard extends ConsumerStatefulWidget {
  const _CurrentSubscriptionCard({required this.subscription});

  final Subscription subscription;

  @override
  ConsumerState<_CurrentSubscriptionCard> createState() =>
      _CurrentSubscriptionCardState();
}

class _CurrentSubscriptionCardState
    extends ConsumerState<_CurrentSubscriptionCard> {
  bool _canceling = false;

  Future<void> _cancel() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Отменить подписку?'),
        content: const Text(
          'Премиум останется активным до конца оплаченного периода, после чего не продлится.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Оставить'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Отменить'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _canceling = true);
    final error = await ref.read(premiumControllerProvider.notifier).cancel();
    if (!mounted) return;
    setState(() => _canceling = false);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(error ?? 'Подписка будет отменена в конце периода'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final sub = widget.subscription;
    final (statusLabel, statusColor) = switch (sub.status) {
      SubscriptionStatus.active => ('Активна', colors.success),
      SubscriptionStatus.canceled => (
        'Отменена',
        context.scheme.onSurfaceVariant,
      ),
      SubscriptionStatus.pastDue => ('Просрочена', colors.warning),
      SubscriptionStatus.none => (
        'Нет подписки',
        context.scheme.onSurfaceVariant,
      ),
    };
    final periodEnd = sub.currentPeriodEnd;

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.xl),
      child: GlassCard(
        glowColor: sub.status == SubscriptionStatus.active
            ? colors.success
            : null,
        glowStrength: 0.3,
        borderRadius: AppRadii.brXxl,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.verified_rounded, size: 20, color: statusColor),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    'Ваша подписка',
                    style: context.texts.titleMedium,
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.sm,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: statusColor.withValues(alpha: 0.15),
                    borderRadius: AppRadii.brPill,
                  ),
                  child: Text(
                    statusLabel,
                    style: context.texts.labelSmall?.copyWith(
                      color: statusColor,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            if (periodEnd != null) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(
                sub.cancelAtPeriodEnd
                    ? 'Действует до ${EconomyFormat.date(periodEnd)}'
                    : 'Продлится ${EconomyFormat.date(periodEnd)}',
                style: context.texts.bodySmall?.copyWith(
                  color: context.scheme.onSurfaceVariant,
                ),
              ),
            ],
            if (sub.status == SubscriptionStatus.active &&
                !sub.cancelAtPeriodEnd) ...[
              const SizedBox(height: AppSpacing.md),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: _canceling ? null : _cancel,
                  child: _canceling
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Отменить подписку'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
