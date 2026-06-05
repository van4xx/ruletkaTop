import 'package:flutter/material.dart';

import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../economy_format.dart';

/// The big coin-balance hero used atop the coins + wallet screens: a glass panel
/// lit by a layered gold + aurora wash, with a glowing stacked-coin glyph, the
/// balance counting up once on first load, and a "Пополнить" CTA. Mirrors the
/// web's `BalanceHero` (gold treatment + count-up flourish).
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
    final scheme = context.scheme;
    final ready = !isLoading && !isError && balance != null;

    return GlassCard(
      glowColor: colors.warning,
      glowStrength: 0.4,
      intensity: 1.15,
      padding: EdgeInsets.zero,
      borderRadius: AppRadii.brXxxl,
      child: Stack(
        children: [
          // Layered gold→aurora wash that pools in the top-right corner.
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topRight,
                  end: Alignment.bottomLeft,
                  colors: [
                    colors.warning.withValues(alpha: 0.20),
                    Colors.transparent,
                    colors.neonViolet.withValues(alpha: 0.12),
                  ],
                  stops: const [0.0, 0.5, 1.0],
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.xl),
            child: Row(
              children: [
                _CoinGlyph(color: colors.warning),
                const SizedBox(width: AppSpacing.lg),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(
                            Icons.account_balance_wallet_rounded,
                            size: 14,
                            color: scheme.onSurfaceVariant,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            'Ваш баланс',
                            style: context.texts.labelMedium?.copyWith(
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.xs),
                      if (isLoading && balance == null)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 6),
                          child: ShimmerBox(width: 130, height: 30),
                        )
                      else
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.baseline,
                          textBaseline: TextBaseline.alphabetic,
                          children: [
                            Flexible(
                              child: _AnimatedBalance(
                                value: isError ? 0 : (balance ?? 0),
                                animate: ready,
                                isError: isError,
                              ),
                            ),
                            const SizedBox(width: AppSpacing.sm),
                            Text(
                              'монет',
                              style: context.texts.bodyMedium?.copyWith(
                                color: scheme.onSurfaceVariant,
                              ),
                            ),
                          ],
                        ),
                    ],
                  ),
                ),
                if (onTopUp != null) ...[
                  const SizedBox(width: AppSpacing.sm),
                  GradientButton(
                    label: 'Пополнить',
                    icon: Icons.add_rounded,
                    onPressed: onTopUp,
                    fullWidth: false,
                    height: 46,
                    gradientColors: [colors.warning, colors.neonMagenta],
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The stacked-coin glyph in a gold-tinted, ring-bordered rounded square — the
/// web's signature coin treatment.
class _CoinGlyph extends StatelessWidget {
  const _CoinGlyph({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 58,
      height: 58,
      decoration: BoxDecoration(
        borderRadius: AppRadii.brXl,
        gradient: RadialGradient(
          colors: [
            color.withValues(alpha: 0.32),
            color.withValues(alpha: 0.12),
          ],
        ),
        border: Border.all(color: color.withValues(alpha: 0.45)),
        boxShadow: AppShadows.glow(color, strength: 0.5),
      ),
      child: Icon(Icons.monetization_on_rounded, color: color, size: 32),
    );
  }
}

/// Counts up to [value] once (the first time a real balance arrives) for a
/// premium flourish; subsequent changes snap. Honours reduced-motion implicitly
/// via the short duration. Renders the gold "coin" balance in tabular figures.
class _AnimatedBalance extends StatefulWidget {
  const _AnimatedBalance({
    required this.value,
    required this.animate,
    required this.isError,
  });

  final int value;
  final bool animate;
  final bool isError;

  @override
  State<_AnimatedBalance> createState() => _AnimatedBalanceState();
}

class _AnimatedBalanceState extends State<_AnimatedBalance> {
  int _from = 0;
  bool _hasRun = false;

  @override
  void didUpdateWidget(_AnimatedBalance old) {
    super.didUpdateWidget(old);
    // Animate from 0 only on the first real value; afterwards snap from the
    // previous figure so polled top-ups read as instant.
    if (widget.value != old.value) {
      _from = _hasRun ? old.value : 0;
    }
  }

  @override
  Widget build(BuildContext context) {
    final style = AppTypography.stat(
      fontSize: 34,
      fontWeight: FontWeight.w800,
      color: context.scheme.onSurface,
    );

    if (widget.isError) {
      return Text('—', style: style);
    }
    if (!widget.animate) {
      return Text(
        EconomyFormat.number(widget.value),
        style: style,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      );
    }

    return TweenAnimationBuilder<double>(
      tween: Tween(begin: _from.toDouble(), end: widget.value.toDouble()),
      duration: _hasRun ? Duration.zero : AppDurations.slow,
      curve: Curves.easeOutCubic,
      onEnd: () => _hasRun = true,
      builder: (context, v, _) => Text(
        EconomyFormat.number(v.round()),
        style: style,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
    );
  }
}
