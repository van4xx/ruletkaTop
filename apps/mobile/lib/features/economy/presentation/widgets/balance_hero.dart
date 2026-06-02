import 'package:flutter/material.dart';

import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../economy_format.dart';

/// The big coin-balance hero used atop the coins + wallet screens: a glass
/// panel with a glowing coin glyph, the formatted balance and a "Пополнить"
/// CTA. Mirrors the web's `BalanceHero`.
class BalanceHero extends StatelessWidget {
  const BalanceHero({
    super.key,
    required this.balance,
    this.isLoading = false,
    this.isError = false,
    this.onTopUp,
  });

  /// The balance, or `null` while loading/unknown.
  final int? balance;
  final bool isLoading;
  final bool isError;
  final VoidCallback? onTopUp;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return GlassCard(
      glowColor: colors.warning,
      glowStrength: 0.35,
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Row(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(
                colors: [
                  colors.warning.withValues(alpha: 0.30),
                  colors.neonMagenta.withValues(alpha: 0.18),
                ],
              ),
              boxShadow: AppShadows.glow(colors.warning, strength: 0.5),
            ),
            child: Icon(Icons.monetization_on_rounded, color: colors.warning, size: 30),
          ),
          const SizedBox(width: AppSpacing.lg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Ваш баланс',
                  style: context.texts.labelMedium
                      ?.copyWith(color: context.scheme.onSurfaceVariant),
                ),
                const SizedBox(height: 2),
                if (isLoading && balance == null)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 6),
                    child: ShimmerBox(width: 120, height: 26),
                  )
                else
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.baseline,
                    textBaseline: TextBaseline.alphabetic,
                    children: [
                      Text(
                        isError ? '—' : EconomyFormat.number(balance ?? 0),
                        style: AppTypography.display(
                          fontSize: 30,
                          color: context.scheme.onSurface,
                        ),
                      ),
                      const SizedBox(width: AppSpacing.sm),
                      Text(
                        'монет',
                        style: context.texts.bodyMedium
                            ?.copyWith(color: context.scheme.onSurfaceVariant),
                      ),
                    ],
                  ),
              ],
            ),
          ),
          if (onTopUp != null)
            GradientButton(
              label: 'Пополнить',
              icon: Icons.add_rounded,
              onPressed: onTopUp,
              fullWidth: false,
              height: 46,
            ),
        ],
      ),
    );
  }
}
