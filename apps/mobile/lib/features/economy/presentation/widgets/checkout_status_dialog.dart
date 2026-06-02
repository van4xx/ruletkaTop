import 'package:flutter/material.dart';

import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../domain/buy_coins_controller.dart';
import '../economy_format.dart';

/// A small status dialog that reflects the tail of the coin-purchase flow
/// (pending / credited / error). The `widget` phase is represented by the
/// CloudPayments sheet itself, so this only shows for the terminal phases.
class CheckoutStatusDialog extends StatelessWidget {
  const CheckoutStatusDialog({
    super.key,
    required this.phase,
    required this.package,
    required this.error,
    required this.onClose,
    required this.onRetry,
  });

  final CheckoutPhase phase;
  final CoinPackage? package;
  final String? error;
  final VoidCallback onClose;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final (icon, iconColor, title, message) = switch (phase) {
      CheckoutPhase.pending => (
          Icons.hourglass_top_rounded,
          colors.neonCyan,
          'Платёж обрабатывается',
          'Зачисляем монеты на ваш баланс. Это займёт пару мгновений.',
        ),
      CheckoutPhase.credited => (
          Icons.check_circle_rounded,
          colors.success,
          'Готово!',
          package != null
              ? '${EconomyFormat.number(package!.totalCoins)} монет зачислено на баланс.'
              : 'Монеты зачислены на баланс.',
        ),
      CheckoutPhase.error => (
          Icons.error_outline_rounded,
          context.scheme.error,
          'Не удалось оплатить',
          error ?? 'Платёж не прошёл. Попробуйте ещё раз.',
        ),
      _ => (Icons.info_outline_rounded, colors.neonViolet, '', ''),
    };

    return AlertDialog(
      icon: phase == CheckoutPhase.pending
          ? SizedBox(
              width: 40,
              height: 40,
              child: CircularProgressIndicator(
                strokeWidth: 3,
                valueColor: AlwaysStoppedAnimation(iconColor),
              ),
            )
          : Icon(icon, color: iconColor, size: 44),
      title: Text(title, textAlign: TextAlign.center),
      content: Text(message, textAlign: TextAlign.center),
      actionsAlignment: MainAxisAlignment.center,
      actions: switch (phase) {
        CheckoutPhase.error => [
            TextButton(onPressed: onClose, child: const Text('Закрыть')),
            FilledButton(onPressed: onRetry, child: const Text('Повторить')),
          ],
        CheckoutPhase.credited => [
            FilledButton(onPressed: onClose, child: const Text('Отлично')),
          ],
        _ => const [],
      },
    );
  }

  /// Whether this dialog should be visible for [phase].
  static bool isVisibleFor(CheckoutPhase phase) =>
      phase == CheckoutPhase.pending ||
      phase == CheckoutPhase.credited ||
      phase == CheckoutPhase.error;
}
