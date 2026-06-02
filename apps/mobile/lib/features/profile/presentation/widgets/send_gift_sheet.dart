import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/di/di.dart';
import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../../../economy/domain/send_gift_controller.dart';
import '../../../economy/presentation/widgets/gift_card.dart';
import '../profile_providers.dart';

/// A bottom sheet for sending a gift to [recipientId] from the public profile.
/// Reads the shared [giftCatalogProvider], visually gates premium-only gifts
/// for non-premium viewers (the server enforces the real rule), and funnels the
/// send through [sendGiftControllerProvider] with [GiftContext.profile].
///
/// Returns `true` to the caller once a gift is sent successfully so the screen
/// can refresh the recipient's showcase.
class SendGiftSheet extends ConsumerStatefulWidget {
  const SendGiftSheet({super.key, required this.recipientId});

  final String recipientId;

  /// Open the sheet; resolves to `true` when a gift was sent.
  static Future<bool?> show(BuildContext context, String recipientId) {
    return showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => SendGiftSheet(recipientId: recipientId),
    );
  }

  @override
  ConsumerState<SendGiftSheet> createState() => _SendGiftSheetState();
}

class _SendGiftSheetState extends ConsumerState<SendGiftSheet> {
  String? _selectedId;

  @override
  Widget build(BuildContext context) {
    final catalogAsync = ref.watch(giftCatalogProvider);
    final viewerPremium = ref.watch(currentUserProvider)?.isPremium ?? false;
    final sending = ref.watch(sendGiftControllerProvider);

    return DraggableScrollableSheet(
      initialChildSize: 0.7,
      minChildSize: 0.5,
      maxChildSize: 0.92,
      expand: false,
      builder: (context, scrollController) {
        return Container(
          decoration: BoxDecoration(
            color: context.scheme.surface,
            borderRadius: const BorderRadius.vertical(
                top: Radius.circular(AppRadii.xxl)),
            border: Border.all(color: context.colors.glassBorder),
          ),
          child: Column(
            children: [
              const SizedBox(height: AppSpacing.sm),
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  borderRadius: AppRadii.brPill,
                  color: context.scheme.onSurfaceVariant
                      .withValues(alpha: 0.4),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(
                    AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.sm),
                child: Row(
                  children: [
                    Icon(Icons.card_giftcard_rounded,
                        color: context.colors.neonMagenta),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: Text('Отправить подарок',
                          style: context.texts.titleLarge),
                    ),
                    IconButton(
                      onPressed: () => Navigator.of(context).pop(),
                      icon: const Icon(Icons.close_rounded),
                      tooltip: 'Закрыть',
                    ),
                  ],
                ),
              ),
              Expanded(
                child: catalogAsync.when(
                  loading: () => const Center(
                      child: CircularProgressIndicator(strokeWidth: 2.4)),
                  error: (_, _) => ErrorView(
                    title: 'Не удалось загрузить подарки',
                    onRetry: () => ref.invalidate(giftCatalogProvider),
                  ),
                  data: (gifts) {
                    if (gifts.isEmpty) {
                      return const EmptyState(
                        icon: Icons.card_giftcard_outlined,
                        title: 'Подарки недоступны',
                        message: 'Загляните позже.',
                      );
                    }
                    return GridView.builder(
                      controller: scrollController,
                      padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 0,
                          AppSpacing.lg, AppSpacing.lg),
                      itemCount: gifts.length,
                      gridDelegate:
                          const SliverGridDelegateWithMaxCrossAxisExtent(
                        maxCrossAxisExtent: 130,
                        mainAxisExtent: 158,
                        crossAxisSpacing: AppSpacing.md,
                        mainAxisSpacing: AppSpacing.md,
                      ),
                      itemBuilder: (_, i) {
                        final gift = gifts[i];
                        final locked = gift.isPremiumOnly && !viewerPremium;
                        return GiftCard(
                          gift: gift,
                          compact: true,
                          locked: locked,
                          selected: _selectedId == gift.id,
                          onTap: () =>
                              setState(() => _selectedId = gift.id),
                        );
                      },
                    );
                  },
                ),
              ),
              SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(AppSpacing.lg, 0,
                      AppSpacing.lg, AppSpacing.lg),
                  child: GradientButton(
                    label: 'Отправить',
                    icon: Icons.send_rounded,
                    loading: sending,
                    onPressed: _selectedId == null
                        ? null
                        : () => _send(_selectedId!),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _send(String giftId) async {
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    final result =
        await ref.read(sendGiftControllerProvider.notifier).send(
              SendGiftDto(
                giftId: giftId,
                toUserId: widget.recipientId,
                context: GiftContext.profile,
              ),
            );
    if (!mounted) return;
    switch (result) {
      case SendGiftSuccess():
        navigator.pop(true);
        messenger.showSnackBar(
          const SnackBar(content: Text('Подарок отправлен')),
        );
      case SendGiftFailure(:final message):
        messenger.showSnackBar(SnackBar(content: Text(message)));
    }
  }
}
