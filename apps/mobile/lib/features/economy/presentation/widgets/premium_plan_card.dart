import 'package:flutter/material.dart';

import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../economy_format.dart';

/// A premium tier card: title, price + interval, the perk list and a subscribe
/// CTA. The [featured] (best-value) plan gets a neon ring + glow and a label.
class PremiumPlanCard extends StatelessWidget {
  const PremiumPlanCard({
    super.key,
    required this.plan,
    required this.onSubscribe,
    this.featured = false,
    this.loading = false,
    this.disabled = false,
    this.isCurrent = false,
  });

  final PremiumPlan plan;
  final VoidCallback onSubscribe;
  final bool featured;
  final bool loading;
  final bool disabled;

  /// The viewer is already subscribed to this plan.
  final bool isCurrent;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final accent = featured ? colors.neonViolet : colors.neonCyan;

    return GlassCard(
      glowColor: featured ? colors.neonViolet : null,
      glowStrength: 0.5,
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(plan.title, style: context.texts.titleLarge),
              ),
              if (featured)
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.sm, vertical: 3),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(colors: colors.ctaGradient),
                    borderRadius: AppRadii.brPill,
                  ),
                  child: Text(
                    'Популярный',
                    style: context.texts.labelSmall
                        ?.copyWith(color: Colors.white, fontWeight: FontWeight.w700),
                  ),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                EconomyFormat.rub(plan.priceRub),
                style: AppTypography.display(
                  fontSize: 28,
                  color: context.scheme.onSurface,
                ),
              ),
              const SizedBox(width: AppSpacing.xs),
              Text(
                EconomyFormat.planInterval(plan.intervalDays),
                style: context.texts.bodySmall
                    ?.copyWith(color: context.scheme.onSurfaceVariant),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          for (final perk in plan.perks)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.check_circle_rounded, size: 18, color: accent),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(perk, style: context.texts.bodyMedium),
                  ),
                ],
              ),
            ),
          const SizedBox(height: AppSpacing.sm),
          if (isCurrent)
            OutlinedButton.icon(
              onPressed: null,
              icon: const Icon(Icons.check_rounded, size: 18),
              label: const Text('Ваш план'),
            )
          else
            GradientButton(
              label: 'Оформить',
              gradientColors: featured ? null : [colors.neonCyan, colors.neonViolet],
              loading: loading,
              onPressed: disabled ? null : onSubscribe,
              height: 48,
            ),
        ],
      ),
    );
  }
}
