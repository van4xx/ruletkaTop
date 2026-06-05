import 'package:flutter/material.dart';

import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../economy_format.dart';

/// A purchasable coin bundle tile: a stacked-coin glyph, the coin amount, an
/// optional bonus + total, the rouble price and a buy CTA. The best-value
/// package gets a violet ring, a brighter glow and a neon "Выгодно" badge.
/// Mirrors the web's `CoinPackageCard` (gold treatment + best-value highlight).
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
    final scheme = context.scheme;

    return GlassCard(
      glowColor: best ? colors.warning : null,
      glowStrength: 0.5,
      intensity: best ? 1.15 : 1,
      borderRadius: AppRadii.brXxl,
      padding: EdgeInsets.zero,
      child: Stack(
        children: [
          // Warm gold glow pooling in the top-right corner.
          Positioned(
            top: -28,
            right: -28,
            child: IgnorePointer(
              child: Container(
                width: 96,
                height: 96,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: RadialGradient(
                    colors: [
                      colors.warning.withValues(alpha: best ? 0.34 : 0.20),
                      Colors.transparent,
                    ],
                  ),
                ),
              ),
            ),
          ),
          // Best-value violet ring drawn over the surface.
          if (best)
            Positioned.fill(
              child: IgnorePointer(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    borderRadius: AppRadii.brXxl,
                    border: Border.all(
                      color: colors.neonViolet.withValues(alpha: 0.65),
                      width: 1.4,
                    ),
                  ),
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        borderRadius: AppRadii.brMd,
                        gradient: RadialGradient(
                          colors: [
                            colors.warning.withValues(alpha: 0.30),
                            colors.warning.withValues(alpha: 0.10),
                          ],
                        ),
                        border: Border.all(
                          color: colors.warning.withValues(alpha: 0.4),
                        ),
                      ),
                      child: Icon(
                        Icons.monetization_on_rounded,
                        color: colors.warning,
                        size: 22,
                      ),
                    ),
                    const Spacer(),
                    if (best) const _BestBadge(),
                  ],
                ),
                const SizedBox(height: AppSpacing.md),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Flexible(
                      child: Text(
                        EconomyFormat.number(package.coins),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppTypography.stat(
                          fontSize: 26,
                          fontWeight: FontWeight.w800,
                          color: scheme.onSurface,
                        ),
                      ),
                    ),
                    const SizedBox(width: 4),
                    Text(
                      'монет',
                      style: context.texts.bodySmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                if (package.bonusCoins > 0)
                  Text(
                    '+${EconomyFormat.number(package.bonusCoins)} бонусом',
                    style: context.texts.bodySmall?.copyWith(
                      color: colors.neonCyan,
                      fontWeight: FontWeight.w700,
                    ),
                  )
                else
                  Text(
                    'на ваш баланс',
                    style: context.texts.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                const SizedBox(height: AppSpacing.lg),
                GradientButton(
                  label: EconomyFormat.rub(package.priceRub),
                  gradientColors: best
                      ? [colors.warning, colors.neonMagenta]
                      : null,
                  loading: loading,
                  onPressed: disabled ? null : onBuy,
                  height: 46,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The neon "Выгодно" best-value pill with a sparkle, on the brand gradient.
class _BestBadge extends StatelessWidget {
  const _BestBadge();

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: 3,
      ),
      decoration: BoxDecoration(
        borderRadius: AppRadii.brPill,
        gradient: LinearGradient(colors: colors.ctaGradient),
        boxShadow: AppShadows.glow(colors.neonViolet, strength: 0.45),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.auto_awesome_rounded, size: 11, color: Colors.white),
          const SizedBox(width: 4),
          Text(
            'Выгодно',
            style: context.texts.labelSmall?.copyWith(
              color: Colors.white,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.2,
            ),
          ),
        ],
      ),
    );
  }
}
