import 'package:flutter/material.dart';

import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../economy_format.dart';

/// A purchasable coin bundle tile: coin amount, optional bonus, price and a buy
/// CTA. The best-value package gets a neon "Выгодно" ribbon + a brighter glow.
class CoinPackageCard extends StatelessWidget {
  const CoinPackageCard({
    super.key,
    required this.package,
    required this.onBuy,
    this.best = false,
    this.loading = false,
    this.disabled = false,
  });

  final CoinPackage package;
  final VoidCallback onBuy;
  final bool best;
  final bool loading;
  final bool disabled;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final accent = best ? colors.warning : colors.neonViolet;

    return GlassCard(
      glowColor: best ? colors.warning : null,
      glowStrength: 0.4,
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Icon(Icons.monetization_on_rounded, color: accent, size: 22),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  EconomyFormat.number(package.coins),
                  style: AppTypography.display(
                    fontSize: 24,
                    color: context.scheme.onSurface,
                  ),
                ),
              ),
              if (best)
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.sm, vertical: 3),
                  decoration: BoxDecoration(
                    color: colors.warning.withValues(alpha: 0.16),
                    borderRadius: AppRadii.brPill,
                    border: Border.all(color: colors.warning.withValues(alpha: 0.5)),
                  ),
                  child: Text(
                    'Выгодно',
                    style: context.texts.labelSmall?.copyWith(
                      color: colors.warning,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            package.bonusCoins > 0
                ? '+${EconomyFormat.number(package.bonusCoins)} бонусом'
                : 'монет на баланс',
            style: context.texts.bodySmall?.copyWith(
              color: package.bonusCoins > 0
                  ? colors.success
                  : context.scheme.onSurfaceVariant,
              fontWeight: package.bonusCoins > 0 ? FontWeight.w700 : null,
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          GradientButton(
            label: EconomyFormat.rub(package.priceRub),
            gradientColors: best ? [colors.warning, colors.neonMagenta] : null,
            loading: loading,
            onPressed: disabled ? null : onBuy,
            height: 46,
          ),
        ],
      ),
    );
  }
}
