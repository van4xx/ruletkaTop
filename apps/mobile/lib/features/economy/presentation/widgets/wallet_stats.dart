import 'package:flutter/material.dart';

import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../economy_format.dart';

/// A derived stats strip over the loaded ledger window: total received, total
/// spent and the operation count — laid out as one divided glass panel with
/// tinted icon squares. Mirrors the web's `WalletStats`.
class WalletStats extends StatelessWidget {
  const WalletStats({
    super.key,
    required this.transactions,
    this.isLoading = false,
  });

  final List<CoinTransaction> transactions;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    var received = 0;
    var spent = 0;
    for (final tx in transactions) {
      if (tx.delta >= 0) {
        received += tx.delta;
      } else {
        spent += -tx.delta;
      }
    }
    final colors = context.colors;

    final items = [
      _StatItem(
        icon: Icons.south_west_rounded,
        tint: colors.success,
        label: 'Получено',
        value: isLoading ? null : EconomyFormat.number(received),
      ),
      _StatItem(
        icon: Icons.north_east_rounded,
        tint: colors.neonMagenta,
        label: 'Потрачено',
        value: isLoading ? null : EconomyFormat.number(spent),
      ),
      _StatItem(
        icon: Icons.receipt_long_rounded,
        tint: colors.neonCyan,
        label: 'Операций',
        value: isLoading ? null : EconomyFormat.number(transactions.length),
      ),
    ];

    return GlassCard(
      borderRadius: AppRadii.brXxl,
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      child: Row(
        children: [
          for (var i = 0; i < items.length; i++) ...[
            if (i > 0)
              Container(width: 1, height: 40, color: colors.glassBorder),
            Expanded(child: items[i]),
          ],
        ],
      ),
    );
  }
}

class _StatItem extends StatelessWidget {
  const _StatItem({
    required this.icon,
    required this.tint,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final Color tint;
  final String label;
  final String? value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
      child: Column(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              borderRadius: AppRadii.brMd,
              color: tint.withValues(alpha: 0.15),
            ),
            child: Icon(icon, size: 19, color: tint),
          ),
          const SizedBox(height: AppSpacing.sm),
          if (value == null)
            const ShimmerBox(width: 44, height: 18)
          else
            Text(
              value!,
              style: AppTypography.stat(
                fontSize: 17,
                fontWeight: FontWeight.w800,
                color: context.scheme.onSurface,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          const SizedBox(height: 2),
          Text(
            label,
            style: context.texts.labelSmall?.copyWith(
              color: context.scheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}
