import 'dart:ui';

import 'package:flutter/material.dart' hide Badge;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/di.dart';
import '../../../core/models/models.dart';
import '../../../core/router/routes.dart';
import '../../../core/theme/theme.dart';
import '../../../core/widgets/widgets.dart';
import '../domain/economy_providers.dart';
import '../domain/send_gift_controller.dart';
import 'economy_format.dart';
import 'widgets/gift_card.dart';
import 'widgets/rarity_style.dart';

/// `/gifts` — the gift catalog, grouped + sorted by rarity (legendary → common)
/// with rarity-tinted cards. Premium-only gifts are gated for non-premium
/// viewers. Tapping a gift opens a recipient sheet to send it; for a preset
/// recipient (profile/chat/call) use the reusable `GiftPicker` instead.
class GiftsScreen extends ConsumerWidget {
  const GiftsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final groups = ref.watch(giftsByRarityProvider);
    final giftsAsync = ref.watch(giftsProvider);
    final balance = ref.watch(coinBalanceProvider);
    final isPremium = ref.watch(currentUserProvider)?.isPremium ?? false;

    return AppScaffold(
      title: 'Подарки',
      currentRoute: null,
      actions: [
        Padding(
          padding: const EdgeInsets.only(right: AppSpacing.sm),
          child: CoinBalancePill(
            balance: balance ?? 0,
            compact: true,
            onTap: () => context.go(AppRoutes.coins),
          ),
        ),
      ],
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(giftsProvider),
        child: giftsAsync.when(
          loading: () => LoadingShimmer.list(items: 6),
          error: (_, _) => ErrorView(
            title: 'Не удалось загрузить подарки',
            message: 'Каталог подарков временно недоступен.',
            onRetry: () => ref.invalidate(giftsProvider),
          ),
          data: (_) {
            if (groups.isEmpty) {
              return const EmptyState(
                icon: Icons.card_giftcard_outlined,
                title: 'Подарков пока нет',
                message: 'Каталог скоро пополнится — загляните позже.',
              );
            }
            return ListView(
              padding: AppSpacing.page,
              children: [
                _GiftsEyebrow(),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  'Дарите эмоции',
                  style: AppTypography.display(
                    fontSize: 26,
                    color: context.scheme.onSurface,
                  ),
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  'Анимированные подарки для звонков, чатов и профилей. Чем выше редкость — тем ярче впечатление.',
                  style: context.texts.bodyMedium?.copyWith(
                    color: context.scheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                if (!isPremium) const _PremiumUpsell(),
                for (final group in groups) ...[
                  const SizedBox(height: AppSpacing.lg),
                  _RarityHeader(group: group),
                  const SizedBox(height: AppSpacing.sm),
                  _RarityGrid(
                    gifts: group.gifts,
                    isPremium: isPremium,
                    onTap: (gift) => _onGiftTap(context, ref, gift, isPremium),
                  ),
                ],
                const SizedBox(height: AppSpacing.xl),
              ],
            );
          },
        ),
      ),
    );
  }

  void _onGiftTap(
    BuildContext context,
    WidgetRef ref,
    Gift gift,
    bool isPremium,
  ) {
    if (gift.isPremiumOnly && !isPremium) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text(
            'Этот подарок доступен только премиум-участникам',
          ),
          action: SnackBarAction(
            label: 'Премиум',
            onPressed: () => context.go(AppRoutes.premium),
          ),
        ),
      );
      return;
    }
    _SendGiftSheet.show(context, gift: gift);
  }
}

class _PremiumUpsell extends StatelessWidget {
  const _PremiumUpsell();

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      margin: const EdgeInsets.only(top: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        borderRadius: AppRadii.brXl,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            colors.warning.withValues(alpha: 0.16),
            colors.neonViolet.withValues(alpha: 0.10),
          ],
        ),
        border: Border.all(color: colors.warning.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: RadialGradient(
                colors: [
                  colors.warning.withValues(alpha: 0.34),
                  colors.warning.withValues(alpha: 0.12),
                ],
              ),
              border: Border.all(color: colors.warning.withValues(alpha: 0.4)),
            ),
            child: Icon(
              Icons.workspace_premium_rounded,
              size: 19,
              color: colors.warning,
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Text(
              'Некоторые подарки доступны только премиум-участникам.',
              style: context.texts.bodySmall,
            ),
          ),
          TextButton(
            onPressed: () => context.go(AppRoutes.premium),
            child: const Text('Подробнее'),
          ),
        ],
      ),
    );
  }
}

/// The small uppercase kicker above the gifts title (magenta, sparkle).
class _GiftsEyebrow extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Row(
      children: [
        Icon(Icons.auto_awesome_rounded, size: 15, color: colors.neonMagenta),
        const SizedBox(width: AppSpacing.xs),
        Text(
          'ПОДАРКИ',
          style: AppTypography.eyebrow(fontSize: 11, color: colors.neonMagenta),
        ),
      ],
    );
  }
}

class _RarityHeader extends StatelessWidget {
  const _RarityHeader({required this.group});

  final GiftRarityGroup group;

  @override
  Widget build(BuildContext context) {
    final style = RarityStyle.of(context, group.rarity);
    return Row(
      children: [
        Container(
          width: 10,
          height: 10,
          margin: const EdgeInsets.only(right: AppSpacing.sm),
          decoration: BoxDecoration(
            color: style.color,
            shape: BoxShape.circle,
            boxShadow: AppShadows.glow(style.color, strength: 0.7),
          ),
        ),
        Text(
          style.label,
          style: context.texts.titleMedium?.copyWith(color: style.color),
        ),
        const SizedBox(width: AppSpacing.sm),
        Container(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.sm,
            vertical: 1,
          ),
          decoration: BoxDecoration(
            color: style.color.withValues(alpha: 0.16),
            borderRadius: AppRadii.brPill,
          ),
          child: Text(
            '${group.gifts.length}',
            style: context.texts.labelSmall?.copyWith(
              color: style.color,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: Container(
            height: 1,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  style.color.withValues(alpha: 0.4),
                  Colors.transparent,
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _RarityGrid extends StatelessWidget {
  const _RarityGrid({
    required this.gifts,
    required this.isPremium,
    required this.onTap,
  });

  final List<Gift> gifts;
  final bool isPremium;
  final ValueChanged<Gift> onTap;

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: gifts.length,
      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
        maxCrossAxisExtent: 130,
        mainAxisExtent: 150,
        crossAxisSpacing: AppSpacing.sm,
        mainAxisSpacing: AppSpacing.sm,
      ),
      itemBuilder: (context, i) {
        final gift = gifts[i];
        return GiftCard(
          gift: gift,
          compact: true,
          locked: gift.isPremiumOnly && !isPremium,
          onTap: () => onTap(gift),
        );
      },
    );
  }
}

/// A small sheet (catalog flow): confirm a chosen gift + enter a recipient id,
/// then send. For preset-recipient flows use the richer `GiftPicker`.
class _SendGiftSheet extends ConsumerStatefulWidget {
  const _SendGiftSheet({required this.gift});

  final Gift gift;

  static Future<void> show(BuildContext context, {required Gift gift}) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _SendGiftSheet(gift: gift),
    );
  }

  @override
  ConsumerState<_SendGiftSheet> createState() => _SendGiftSheetState();
}

class _SendGiftSheetState extends ConsumerState<_SendGiftSheet> {
  final _recipientController = TextEditingController();
  final _messageController = TextEditingController();

  @override
  void dispose() {
    _recipientController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final recipient = _recipientController.text.trim();
    if (recipient.isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Укажите получателя')));
      return;
    }
    FocusScope.of(context).unfocus();
    final message = _messageController.text.trim();
    final result = await ref
        .read(sendGiftControllerProvider.notifier)
        .send(
          SendGiftDto(
            giftId: widget.gift.id,
            toUserId: recipient,
            context: GiftContext.profile,
            message: message.isEmpty ? null : message,
          ),
        );
    if (!mounted) return;
    switch (result) {
      case SendGiftSuccess():
        Navigator.of(context).pop();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Подарок «${widget.gift.title}» отправлен')),
        );
      case SendGiftFailure(:final message):
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final gift = widget.gift;
    final balance = ref.watch(coinBalanceProvider);
    final sending = ref.watch(sendGiftControllerProvider);
    final style = RarityStyle.of(context, gift.rarity);
    final affordable = balance == null || balance >= gift.priceCoins;
    final insets = MediaQuery.viewInsetsOf(context);

    return Padding(
      padding: EdgeInsets.only(bottom: insets.bottom),
      child: ClipRRect(
        borderRadius: const BorderRadius.vertical(
          top: Radius.circular(AppRadii.xxl),
        ),
        child: BackdropFilter(
          filter: ImageFilter.blur(
            sigmaX: AppBlur.heavy,
            sigmaY: AppBlur.heavy,
          ),
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: context.scheme.surface.withValues(alpha: 0.88),
              border: Border(
                top: BorderSide(
                  color: colors.glassHighlight.withValues(alpha: 0.2),
                ),
              ),
            ),
            child: SafeArea(
              top: false,
              child: Padding(
                padding: AppSpacing.page,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Center(
                      child: Container(
                        width: 40,
                        height: 4,
                        decoration: BoxDecoration(
                          color: colors.glassBorder,
                          borderRadius: AppRadii.brPill,
                        ),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    Row(
                      children: [
                        SizedBox(
                          width: 64,
                          height: 64,
                          child: GiftCard(
                            gift: gift,
                            compact: true,
                            onTap: () {},
                          ),
                        ),
                        const SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                gift.title,
                                style: context.texts.titleMedium,
                              ),
                              const SizedBox(height: AppSpacing.xs),
                              Row(
                                children: [
                                  RarityChip(rarity: gift.rarity),
                                  const SizedBox(width: AppSpacing.sm),
                                  Icon(
                                    Icons.monetization_on_rounded,
                                    size: 14,
                                    color: colors.warning,
                                  ),
                                  const SizedBox(width: 3),
                                  Text(
                                    EconomyFormat.number(gift.priceCoins),
                                    style: context.texts.labelMedium?.copyWith(
                                      color: style.color,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    TextField(
                      controller: _recipientController,
                      decoration: const InputDecoration(
                        labelText: 'ID получателя',
                        hintText: 'Кому отправить',
                        prefixIcon: Icon(Icons.person_outline_rounded),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    TextField(
                      controller: _messageController,
                      maxLength: 200,
                      maxLines: 2,
                      minLines: 1,
                      decoration: const InputDecoration(
                        hintText: 'Сообщение (необязательно)',
                        counterText: '',
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    if (!affordable) ...[
                      GradientButton(
                        label: 'Пополнить баланс',
                        icon: Icons.add_rounded,
                        onPressed: () {
                          Navigator.of(context).pop();
                          context.go(AppRoutes.coins);
                        },
                      ),
                      const SizedBox(height: AppSpacing.xs),
                      Text(
                        'Недостаточно монет для этого подарка',
                        textAlign: TextAlign.center,
                        style: context.texts.bodySmall?.copyWith(
                          color: context.scheme.onSurfaceVariant,
                        ),
                      ),
                    ] else
                      GradientButton(
                        label: 'Отправить подарок',
                        icon: Icons.send_rounded,
                        loading: sending,
                        onPressed: _send,
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
