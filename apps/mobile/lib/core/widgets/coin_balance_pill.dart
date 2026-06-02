import 'package:flutter/material.dart';

import '../theme/theme.dart';

/// A compact coin-balance chip for the app bar / wallet entry points: a coin
/// glyph, the formatted [balance], and an optional trailing "+" that routes to
/// the top-up flow. Mirrors the web header's coin pill.
class CoinBalancePill extends StatelessWidget {
  const CoinBalancePill({
    super.key,
    required this.balance,
    this.onTap,
    this.onAddTap,
    this.compact = false,
  });

  final int balance;

  /// Tapping the pill body (e.g. open the wallet).
  final VoidCallback? onTap;

  /// Tapping the trailing "+" (e.g. open the coins purchase). When null, the
  /// "+" affordance is hidden.
  final VoidCallback? onAddTap;

  /// Drops the "+" and tightens padding (for dense rows).
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;
    final showAdd = !compact && onAddTap != null;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppRadii.brPill,
        child: Container(
          padding: EdgeInsets.fromLTRB(AppSpacing.md, 6, showAdd ? 4 : AppSpacing.md, 6),
          decoration: BoxDecoration(
            borderRadius: AppRadii.brPill,
            border: Border.all(color: colors.glassBorder),
            gradient: LinearGradient(
              colors: [
                colors.warning.withValues(alpha: 0.18),
                colors.neonMagenta.withValues(alpha: 0.10),
              ],
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.monetization_on_rounded, size: 18, color: colors.warning),
              const SizedBox(width: 6),
              Text(
                _format(balance),
                style: context.texts.labelLarge?.copyWith(
                  color: scheme.onSurface,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (showAdd) ...[
                const SizedBox(width: AppSpacing.sm),
                _AddButton(onTap: onAddTap!),
              ],
            ],
          ),
        ),
      ),
    );
  }

  /// Group thousands with a thin space (e.g. `12 500`).
  static String _format(int value) {
    final s = value.abs().toString();
    final buf = StringBuffer(value < 0 ? '-' : '');
    for (var i = 0; i < s.length; i++) {
      if (i != 0 && (s.length - i) % 3 == 0) buf.write(' ');
      buf.write(s[i]);
    }
    return buf.toString();
  }
}

class _AddButton extends StatelessWidget {
  const _AddButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return InkWell(
      onTap: onTap,
      borderRadius: AppRadii.brPill,
      child: Container(
        width: 26,
        height: 26,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: LinearGradient(colors: colors.ctaGradient),
        ),
        child: const Icon(Icons.add_rounded, size: 18, color: Colors.white),
      ),
    );
  }
}
