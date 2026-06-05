import 'dart:ui';

import 'package:flutter/material.dart' hide Badge;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/models/models.dart';
import '../../../../core/router/routes.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../../domain/economy_providers.dart';
import '../../domain/send_gift_controller.dart';
import '../economy_format.dart';
import 'gift_card.dart';
import 'rarity_style.dart';

/// A reusable bottom sheet for sending a gift to a user.
///
/// This is THE shared gift entry point — call [GiftPicker.show] from the call
/// screen, a chat thread or a profile. It loads the catalog (rarity-styled),
/// gates premium-only gifts for non-premium senders, lets the user attach a
/// short message, validates the coin cost against the live balance, then sends
/// via `POST /gifts/send`.
///
/// Resolves with the created [GiftTransaction] on success, or `null` if the
/// sheet was dismissed.
class GiftPicker extends ConsumerStatefulWidget {
  const GiftPicker({
    super.key,
    required this.toUserId,
    required this.context,
    this.toName,
    this.viewerIsPremium = false,
  });

  /// Recipient user id (`toUserId` in `sendGiftSchema`).
  final String toUserId;

  /// Where the gift is being sent from (`call` / `chat` / `profile`).
  final GiftContext context;

  /// Recipient display name, for the sheet header.
  final String? toName;

  /// Whether the sender is premium (unlocks `isPremiumOnly` gifts).
  final bool viewerIsPremium;

  /// Present the picker as a modal sheet and await the outcome.
  static Future<GiftTransaction?> show(
    BuildContext context, {
    required String toUserId,
    required GiftContext giftContext,
    String? toName,
    bool viewerIsPremium = false,
  }) {
    return showModalBottomSheet<GiftTransaction>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => GiftPicker(
        toUserId: toUserId,
        context: giftContext,
        toName: toName,
        viewerIsPremium: viewerIsPremium,
      ),
    );
  }

  @override
  ConsumerState<GiftPicker> createState() => _GiftPickerState();
}

class _GiftPickerState extends ConsumerState<GiftPicker> {
  Gift? _selected;
  final _messageController = TextEditingController();

  @override
  void dispose() {
    _messageController.dispose();
    super.dispose();
  }

  bool _isLocked(Gift gift) => gift.isPremiumOnly && !widget.viewerIsPremium;

  Future<void> _send() async {
    final gift = _selected;
    if (gift == null) return;
    FocusScope.of(context).unfocus();

    final message = _messageController.text.trim();
    final result = await ref
        .read(sendGiftControllerProvider.notifier)
        .send(
          SendGiftDto(
            giftId: gift.id,
            toUserId: widget.toUserId,
            context: widget.context,
            message: message.isEmpty ? null : message,
          ),
        );
    if (!mounted) return;

    switch (result) {
      case SendGiftSuccess(:final transaction):
        Navigator.of(context).pop(transaction);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Подарок «${gift.title}» отправлен')),
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
    final gifts = ref.watch(giftsProvider);
    final balance = ref.watch(coinBalanceProvider);
    final isSending = ref.watch(sendGiftControllerProvider);

    final selected = _selected;
    final affordable =
        selected == null || balance == null || balance >= selected.priceCoins;
    final insets = MediaQuery.viewInsetsOf(context);

    return Padding(
      padding: EdgeInsets.only(bottom: insets.bottom),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.78,
        minChildSize: 0.5,
        maxChildSize: 0.95,
        builder: (context, scrollController) {
          return ClipRRect(
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
                  color: context.scheme.surface.withValues(alpha: 0.86),
                  border: Border(
                    top: BorderSide(
                      color: colors.glassHighlight.withValues(alpha: 0.2),
                    ),
                  ),
                ),
                child: Column(
                  children: [
                    const _SheetGrip(),
                    _Header(toName: widget.toName, balance: balance),
                    Divider(height: 1, color: colors.glassBorder),
                    Expanded(
                      child: gifts.when(
                        loading: () =>
                            const Center(child: CircularProgressIndicator()),
                        error: (_, _) => ErrorView(
                          title: 'Не удалось загрузить подарки',
                          onRetry: () => ref.invalidate(giftsProvider),
                        ),
                        data: (list) => _GiftGrid(
                          gifts: list,
                          selectedId: selected?.id,
                          isLocked: _isLocked,
                          scrollController: scrollController,
                          onPick: (g) {
                            if (_isLocked(g)) {
                              _promptPremium();
                              return;
                            }
                            setState(() => _selected = g);
                          },
                        ),
                      ),
                    ),
                    if (selected != null)
                      _SendBar(
                        gift: selected,
                        messageController: _messageController,
                        sending: isSending,
                        affordable: affordable,
                        onSend: _send,
                        onTopUp: () {
                          Navigator.of(context).pop();
                          context.push(AppRoutes.coins);
                        },
                      ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  void _promptPremium() {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('Этот подарок доступен только премиум-участникам'),
        action: SnackBarAction(
          label: 'Премиум',
          onPressed: () {
            Navigator.of(context).pop();
            context.push(AppRoutes.premium);
          },
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.toName, required this.balance});

  final String? toName;
  final int? balance;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.xs,
        AppSpacing.lg,
        AppSpacing.md,
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Отправить подарок', style: context.texts.titleLarge),
                if (toName != null && toName!.isNotEmpty)
                  Text(
                    'Для $toName',
                    style: context.texts.bodySmall?.copyWith(
                      color: context.scheme.onSurfaceVariant,
                    ),
                  ),
              ],
            ),
          ),
          CoinBalancePill(balance: balance ?? 0, compact: true),
        ],
      ),
    );
  }
}

class _GiftGrid extends StatelessWidget {
  const _GiftGrid({
    required this.gifts,
    required this.selectedId,
    required this.isLocked,
    required this.scrollController,
    required this.onPick,
  });

  final List<Gift> gifts;
  final String? selectedId;
  final bool Function(Gift) isLocked;
  final ScrollController scrollController;
  final ValueChanged<Gift> onPick;

  @override
  Widget build(BuildContext context) {
    if (gifts.isEmpty) {
      return const EmptyState(
        icon: Icons.card_giftcard_outlined,
        title: 'Подарков пока нет',
        message: 'Каталог скоро пополнится.',
      );
    }
    return GridView.builder(
      controller: scrollController,
      padding: AppSpacing.page,
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
          selected: gift.id == selectedId,
          locked: isLocked(gift),
          onTap: () => onPick(gift),
        );
      },
    );
  }
}

class _SendBar extends StatelessWidget {
  const _SendBar({
    required this.gift,
    required this.messageController,
    required this.sending,
    required this.affordable,
    required this.onSend,
    required this.onTopUp,
  });

  final Gift gift;
  final TextEditingController messageController;
  final bool sending;
  final bool affordable;
  final VoidCallback onSend;
  final VoidCallback onTopUp;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final style = RarityStyle.of(context, gift.rarity);

    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: context.scheme.surface,
        border: Border(top: BorderSide(color: colors.glassBorder)),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                RarityChip(rarity: gift.rarity),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    gift.title,
                    style: context.texts.titleSmall,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Icon(
                  Icons.monetization_on_rounded,
                  size: 16,
                  color: colors.warning,
                ),
                const SizedBox(width: 4),
                Text(
                  EconomyFormat.number(gift.priceCoins),
                  style: context.texts.titleSmall?.copyWith(
                    color: style.color,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            TextField(
              controller: messageController,
              maxLength: 200,
              maxLines: 2,
              minLines: 1,
              textInputAction: TextInputAction.done,
              decoration: const InputDecoration(
                hintText: 'Добавить сообщение (необязательно)',
                counterText: '',
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            if (!affordable) ...[
              GradientButton(
                label: 'Пополнить баланс',
                icon: Icons.add_rounded,
                onPressed: onTopUp,
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Недостаточно монет для этого подарка',
                style: context.texts.bodySmall?.copyWith(
                  color: context.scheme.onSurfaceVariant,
                ),
              ),
            ] else
              GradientButton(
                label: 'Отправить подарок',
                icon: Icons.send_rounded,
                loading: sending,
                onPressed: onSend,
              ),
          ],
        ),
      ),
    );
  }
}

class _SheetGrip extends StatelessWidget {
  const _SheetGrip();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 40,
      height: 4,
      margin: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
      decoration: BoxDecoration(
        color: context.colors.glassBorder,
        borderRadius: AppRadii.brPill,
      ),
    );
  }
}
