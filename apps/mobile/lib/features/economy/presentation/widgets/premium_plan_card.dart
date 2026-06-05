import 'package:flutter/material.dart';

import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../economy_format.dart';

/// A premium tier card: a crowned title, the price + interval, a perk checklist
/// (success-tinted checks) and a subscribe CTA. The [featured] (best-value) plan
/// is wrapped in the signature brand-gradient border, lifted with a violet glow
/// and tagged "Популярный". Mirrors the web's `PlanCard`.
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
    final card = _card(context);

    if (!featured) return card;

    // Featured: a brand-gradient border frame with a soft violet bloom behind.
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: AppRadii.brXxxl,
        boxShadow: AppShadows.glow(colors.neonViolet, strength: 0.5),
      ),
      child: Container(
        padding: const EdgeInsets.all(1.4),
        decoration: BoxDecoration(
          borderRadius: AppRadii.brXxxl,
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [colors.neonViolet, colors.neonMagenta, colors.neonCyan],
          ),
        ),
        child: card,
      ),
    );
  }

  Widget _card(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;

    return GlassCard(
      // The featured card sits inside a gradient frame, so it draws no border
      // or extra shadow of its own — the frame supplies both.
      border: !featured,
      shadow: !featured,
      intensity: featured ? 1.2 : 1,
      borderRadius: AppRadii.brXxl,
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Icon(
                Icons.workspace_premium_rounded,
                size: 20,
                color: featured ? colors.neonMagenta : colors.warning,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(plan.title, style: context.texts.titleLarge),
              ),
              if (isCurrent)
                _StatusPill(label: 'Активен', color: colors.success, dot: true)
              else if (featured)
                const _PopularPill(),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                EconomyFormat.rub(plan.priceRub),
                style: AppTypography.stat(
                  fontSize: 30,
                  fontWeight: FontWeight.w800,
                  color: scheme.onSurface,
                ),
              ),
              const SizedBox(width: AppSpacing.xs),
              Text(
                EconomyFormat.planInterval(plan.intervalDays),
                style: context.texts.bodySmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
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
                  Container(
                    width: 20,
                    height: 20,
                    margin: const EdgeInsets.only(top: 1),
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: colors.success.withValues(alpha: 0.16),
                    ),
                    child: Icon(
                      Icons.check_rounded,
                      size: 13,
                      color: colors.success,
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      perk,
                      style: context.texts.bodyMedium?.copyWith(
                        color: scheme.onSurface.withValues(alpha: 0.92),
                      ),
                    ),
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
              gradientColors: featured
                  ? null
                  : [colors.neonCyan, colors.neonViolet],
              loading: loading,
              onPressed: disabled ? null : onSubscribe,
              height: 50,
            ),
        ],
      ),
    );
  }
}

/// The brand-gradient "Популярный" pill with a sparkle.
class _PopularPill extends StatelessWidget {
  const _PopularPill();

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: 3,
      ),
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: colors.ctaGradient),
        borderRadius: AppRadii.brPill,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.auto_awesome_rounded, size: 11, color: Colors.white),
          const SizedBox(width: 4),
          Text(
            'Популярный',
            style: context.texts.labelSmall?.copyWith(
              color: Colors.white,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

/// A tinted status pill (e.g. the active-subscription marker), with an optional
/// leading dot.
class _StatusPill extends StatelessWidget {
  const _StatusPill({
    required this.label,
    required this.color,
    this.dot = false,
  });

  final String label;
  final Color color;
  final bool dot;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: 3,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: AppRadii.brPill,
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (dot) ...[
            Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            ),
            const SizedBox(width: 5),
          ],
          Text(
            label,
            style: context.texts.labelSmall?.copyWith(
              color: color,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}
