import 'package:flutter/material.dart';

import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../../domain/buy_coins_controller.dart';
import '../economy_format.dart';

/// A liquid-glass status dialog reflecting the tail of the coin-purchase flow
/// (pending / credited / error). The `widget` phase is represented by the
/// CloudPayments sheet itself, so this only shows for the terminal phases. The
/// success state celebrates with a gold-glowing check; pending shows a spinner.
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

    return Dialog(
      backgroundColor: Colors.transparent,
      elevation: 0,
      insetPadding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
      child: GlassCard(
        glowColor: iconColor,
        glowStrength: 0.5,
        intensity: 1.2,
        borderRadius: AppRadii.brXxxl,
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.xl,
          AppSpacing.xxl,
          AppSpacing.xl,
          AppSpacing.lg,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _StatusGlyph(
              phase: phase,
              icon: icon,
              color: iconColor,
              isCredited: phase == CheckoutPhase.credited,
            ),
            const SizedBox(height: AppSpacing.lg),
            Text(
              title,
              textAlign: TextAlign.center,
              style: AppTypography.display(
                fontSize: 22,
                color: context.scheme.onSurface,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              message,
              textAlign: TextAlign.center,
              style: context.texts.bodyMedium?.copyWith(
                color: context.scheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: AppSpacing.xl),
            ..._actions(context),
          ],
        ),
      ),
    );
  }

  List<Widget> _actions(BuildContext context) {
    switch (phase) {
      case CheckoutPhase.error:
        return [
          GradientButton(label: 'Повторить', onPressed: onRetry, height: 50),
          const SizedBox(height: AppSpacing.sm),
          TextButton(onPressed: onClose, child: const Text('Закрыть')),
        ];
      case CheckoutPhase.credited:
        return [
          GradientButton(
            label: 'Отлично',
            icon: Icons.celebration_rounded,
            onPressed: onClose,
            height: 50,
            gradientColors: [context.colors.success, context.colors.neonCyan],
          ),
        ];
      default:
        return const [];
    }
  }

  /// Whether this dialog should be visible for [phase].
  static bool isVisibleFor(CheckoutPhase phase) =>
      phase == CheckoutPhase.pending ||
      phase == CheckoutPhase.credited ||
      phase == CheckoutPhase.error;
}

/// The status glyph: a glowing tinted disc with the phase icon, or a spinner
/// while pending.
class _StatusGlyph extends StatelessWidget {
  const _StatusGlyph({
    required this.phase,
    required this.icon,
    required this.color,
    required this.isCredited,
  });

  final CheckoutPhase phase;
  final IconData icon;
  final Color color;
  final bool isCredited;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 76,
      height: 76,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: RadialGradient(
          colors: [
            color.withValues(alpha: 0.28),
            color.withValues(alpha: 0.08),
          ],
        ),
        border: Border.all(color: color.withValues(alpha: 0.45)),
        boxShadow: AppShadows.glow(color, strength: isCredited ? 0.8 : 0.5),
      ),
      child: phase == CheckoutPhase.pending
          ? Padding(
              padding: const EdgeInsets.all(22),
              child: CircularProgressIndicator(
                strokeWidth: 3,
                valueColor: AlwaysStoppedAnimation(color),
              ),
            )
          : Icon(icon, color: color, size: 40),
    );
  }
}
