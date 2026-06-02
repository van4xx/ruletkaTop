import 'package:flutter/material.dart' hide Badge;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/api/api.dart';
import '../../../../core/di/di.dart';
import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';

/// Toast helper used across the call action dialogs.
void showCallToast(BuildContext context, String message, {bool error = false}) {
  final scheme = Theme.of(context).colorScheme;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(message),
        behavior: SnackBarBehavior.floating,
        backgroundColor: error ? scheme.error : null,
      ),
    );
}

// ────────────────────────────── Gift picker ───────────────────────────────

/// A gift picker bottom sheet: loads the catalog + the caller's coin balance,
/// lets the user pick a gift and send it (context = `call`). Mirrors the web
/// `GiftPicker`. Returns nothing; surfaces success/failure via a toast.
Future<void> showGiftPicker(
  BuildContext context, {
  required String toUserId,
  required String peerName,
  required bool isPremium,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _GiftPickerSheet(toUserId: toUserId, peerName: peerName, isPremium: isPremium),
  );
}

class _GiftPickerSheet extends ConsumerStatefulWidget {
  const _GiftPickerSheet({
    required this.toUserId,
    required this.peerName,
    required this.isPremium,
  });

  final String toUserId;
  final String peerName;
  final bool isPremium;

  @override
  ConsumerState<_GiftPickerSheet> createState() => _GiftPickerSheetState();
}

class _GiftPickerSheetState extends ConsumerState<_GiftPickerSheet> {
  late Future<(List<Gift>, Wallet)> _future;
  String? _sendingGiftId;

  @override
  void initState() {
    super.initState();
    final api = ref.read(apiClientProvider);
    _future = Future.wait([api.gifts(), api.wallet()]).then((r) => (r[0] as List<Gift>, r[1] as Wallet));
  }

  Future<void> _send(Gift gift, int balance) async {
    if (gift.priceCoins > balance) {
      showCallToast(context, 'Недостаточно монет', error: true);
      return;
    }
    setState(() => _sendingGiftId = gift.id);
    try {
      await ref.read(apiClientProvider).sendGift(SendGiftDto(
            giftId: gift.id,
            toUserId: widget.toUserId,
            context: GiftContext.call,
          ));
      if (!mounted) return;
      Navigator.of(context).pop();
      showCallToast(context, 'Подарок отправлен ${widget.peerName}');
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _sendingGiftId = null);
      showCallToast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;
    return SafeArea(
      top: false,
      child: GlassCard(
        margin: const EdgeInsets.all(AppSpacing.sm),
        padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.lg),
        borderRadius: AppRadii.brXxl,
        blurSigma: 24,
        child: FutureBuilder<(List<Gift>, Wallet)>(
          future: _future,
          builder: (context, snap) {
            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: scheme.onSurfaceVariant.withValues(alpha: 0.3),
                      borderRadius: AppRadii.brPill,
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Подарок для ${widget.peerName}',
                        style: AppTypography.display(fontSize: 18, color: scheme.onSurface),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (snap.hasData)
                      CoinBalancePill(balance: snap.data!.$2.balanceCoins, compact: true),
                  ],
                ),
                const SizedBox(height: AppSpacing.lg),
                if (snap.connectionState == ConnectionState.waiting)
                  const Padding(
                    padding: EdgeInsets.all(AppSpacing.xl),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (snap.hasError)
                  Padding(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    child: Text(
                      'Не удалось загрузить подарки',
                      style: context.texts.bodyMedium?.copyWith(color: scheme.error),
                    ),
                  )
                else if (snap.hasData)
                  _GiftGrid(
                    gifts: snap.data!.$1,
                    balance: snap.data!.$2.balanceCoins,
                    isPremium: widget.isPremium,
                    sendingGiftId: _sendingGiftId,
                    onSend: (g) => _send(g, snap.data!.$2.balanceCoins),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _GiftGrid extends StatelessWidget {
  const _GiftGrid({
    required this.gifts,
    required this.balance,
    required this.isPremium,
    required this.sendingGiftId,
    required this.onSend,
  });

  final List<Gift> gifts;
  final int balance;
  final bool isPremium;
  final String? sendingGiftId;
  final ValueChanged<Gift> onSend;

  @override
  Widget build(BuildContext context) {
    if (gifts.isEmpty) {
      return const Padding(
        padding: EdgeInsets.all(AppSpacing.lg),
        child: Text('Каталог подарков пуст'),
      );
    }
    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.5),
      child: GridView.builder(
        shrinkWrap: true,
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 3,
          mainAxisSpacing: AppSpacing.sm,
          crossAxisSpacing: AppSpacing.sm,
          childAspectRatio: 0.82,
        ),
        itemCount: gifts.length,
        itemBuilder: (context, i) {
          final gift = gifts[i];
          final locked = gift.isPremiumOnly && !isPremium;
          final unaffordable = gift.priceCoins > balance;
          final sending = sendingGiftId == gift.id;
          return _GiftCard(
            gift: gift,
            disabled: locked || unaffordable || sendingGiftId != null,
            locked: locked,
            sending: sending,
            onTap: () => onSend(gift),
          );
        },
      ),
    );
  }
}

class _GiftCard extends StatelessWidget {
  const _GiftCard({
    required this.gift,
    required this.disabled,
    required this.locked,
    required this.sending,
    required this.onTap,
  });

  final Gift gift;
  final bool disabled;
  final bool locked;
  final bool sending;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;
    return Opacity(
      opacity: disabled && !sending ? 0.5 : 1,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: disabled ? null : onTap,
          borderRadius: AppRadii.brLg,
          child: Container(
            padding: const EdgeInsets.all(AppSpacing.sm),
            decoration: BoxDecoration(
              borderRadius: AppRadii.brLg,
              color: scheme.surfaceContainerHighest.withValues(alpha: 0.4),
              border: Border.all(color: colors.glassBorder),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Expanded(
                  child: sending
                      ? const Center(
                          child: SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        )
                      : Center(
                          child: locked
                              ? Icon(Icons.lock_rounded, color: colors.warning, size: 28)
                              : Icon(Icons.card_giftcard_rounded, color: colors.neonMagenta, size: 30),
                        ),
                ),
                const SizedBox(height: 4),
                Text(
                  gift.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: context.texts.labelSmall?.copyWith(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 2),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.monetization_on_rounded, size: 12, color: colors.warning),
                    const SizedBox(width: 3),
                    Text(
                      '${gift.priceCoins}',
                      style: context.texts.labelSmall?.copyWith(
                        color: scheme.onSurface,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────── Report ───────────────────────────────────

const Map<ReportReason, String> _reasonLabels = {
  ReportReason.nudity: 'Нагота / 18+',
  ReportReason.harassment: 'Оскорбления',
  ReportReason.minor: 'Несовершеннолетний',
  ReportReason.violence: 'Насилие',
  ReportReason.spam: 'Спам',
  ReportReason.scam: 'Мошенничество',
  ReportReason.other: 'Другое',
};

/// Report dialog. On success calls [onReported] (the stage skips to the next
/// peer). Mirrors the web `ReportDialog`.
Future<void> showReportDialog(
  BuildContext context, {
  required WidgetRef ref,
  required String againstUserId,
  required String peerName,
  required VoidCallback onReported,
}) {
  return showDialog<void>(
    context: context,
    builder: (_) => _ReportDialog(
      ref: ref,
      againstUserId: againstUserId,
      peerName: peerName,
      onReported: onReported,
    ),
  );
}

class _ReportDialog extends StatefulWidget {
  const _ReportDialog({
    required this.ref,
    required this.againstUserId,
    required this.peerName,
    required this.onReported,
  });

  final WidgetRef ref;
  final String againstUserId;
  final String peerName;
  final VoidCallback onReported;

  @override
  State<_ReportDialog> createState() => _ReportDialogState();
}

class _ReportDialogState extends State<_ReportDialog> {
  ReportReason _reason = ReportReason.harassment;
  final TextEditingController _details = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    _details.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() => _submitting = true);
    try {
      await widget.ref.read(apiClientProvider).report(CreateReportDto(
            againstUserId: widget.againstUserId,
            reason: _reason,
            details: _details.text.trim().isEmpty ? null : _details.text.trim(),
          ));
      if (!mounted) return;
      Navigator.of(context).pop();
      showCallToast(context, 'Жалоба отправлена');
      widget.onReported();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _submitting = false);
      showCallToast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('Пожаловаться на ${widget.peerName}'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Причина', style: context.texts.titleSmall),
            const SizedBox(height: AppSpacing.sm),
            // RadioGroup owns the selected value + change handler; each tile
            // just declares its `value` (the pre-3.32 per-tile groupValue/
            // onChanged API is deprecated).
            RadioGroup<ReportReason>(
              groupValue: _reason,
              onChanged: (v) {
                if (_submitting || v == null) return;
                setState(() => _reason = v);
              },
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (final e in _reasonLabels.entries)
                    RadioListTile<ReportReason>(
                      value: e.key,
                      enabled: !_submitting,
                      title: Text(e.value),
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                    ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            TextField(
              controller: _details,
              enabled: !_submitting,
              minLines: 2,
              maxLines: 4,
              maxLength: 500,
              decoration: const InputDecoration(
                hintText: 'Подробности (необязательно)',
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _submitting ? null : () => Navigator.of(context).pop(),
          child: const Text('Отмена'),
        ),
        FilledButton(
          onPressed: _submitting ? null : _submit,
          style: FilledButton.styleFrom(backgroundColor: context.scheme.error),
          child: _submitting
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text('Отправить'),
        ),
      ],
    );
  }
}

// ─────────────────────────────── Block ────────────────────────────────────

/// Block confirmation dialog. On success calls [onBlocked] (the stage skips to
/// the next peer). Mirrors the web `BlockConfirmDialog`.
Future<void> showBlockDialog(
  BuildContext context, {
  required WidgetRef ref,
  required String blockedUserId,
  required String peerName,
  required VoidCallback onBlocked,
}) {
  return showDialog<void>(
    context: context,
    builder: (_) => _BlockDialog(
      ref: ref,
      blockedUserId: blockedUserId,
      peerName: peerName,
      onBlocked: onBlocked,
    ),
  );
}

class _BlockDialog extends StatefulWidget {
  const _BlockDialog({
    required this.ref,
    required this.blockedUserId,
    required this.peerName,
    required this.onBlocked,
  });

  final WidgetRef ref;
  final String blockedUserId;
  final String peerName;
  final VoidCallback onBlocked;

  @override
  State<_BlockDialog> createState() => _BlockDialogState();
}

class _BlockDialogState extends State<_BlockDialog> {
  bool _submitting = false;

  Future<void> _submit() async {
    setState(() => _submitting = true);
    try {
      await widget.ref.read(apiClientProvider).block(widget.blockedUserId);
      if (!mounted) return;
      Navigator.of(context).pop();
      showCallToast(context, '${widget.peerName} заблокирован(а)');
      widget.onBlocked();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _submitting = false);
      showCallToast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('Заблокировать ${widget.peerName}?'),
      content: const Text(
        'Вы больше не будете встречать этого пользователя в рулетке, а он — вас. '
        'Разблокировать можно в настройках.',
      ),
      actions: [
        TextButton(
          onPressed: _submitting ? null : () => Navigator.of(context).pop(),
          child: const Text('Отмена'),
        ),
        FilledButton(
          onPressed: _submitting ? null : _submit,
          style: FilledButton.styleFrom(backgroundColor: context.scheme.error),
          child: _submitting
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text('Заблокировать'),
        ),
      ],
    );
  }
}
