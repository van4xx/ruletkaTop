import 'package:flutter/material.dart';

import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../economy_format.dart';

/// A derived stats strip over the loaded ledger window: total received, total
/// spent and the operation count. Mirrors the web's `WalletStats`.
class WalletStats extends StatelessWidget {
  const WalletStats({super.key, required this.transactions, this.isLoading = false});

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

    return Row(
      children: [
        Expanded(
          child: _StatTile(
            icon: Icons.south_west_rounded,
            tint: colors.success,
            label: 'Получено',
            value: isLoading ? null : EconomyFormat.number(received),
          ),
        ),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: _StatTile(
            icon: Icons.north_east_rounded,
            tint: colors.neonMagenta,
            label: 'Потрачено',
            value: isLoading ? null : EconomyFormat.number(spent),
          ),
        ),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: _StatTile(
            icon: Icons.receipt_long_rounded,
            tint: colors.neonCyan,
            label: 'Операций',
            value: isLoading ? null : EconomyFormat.number(transactions.length),
          ),
        ),
      ],
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({
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
    return GlassCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: tint),
          const SizedBox(height: AppSpacing.sm),
          if (value == null)
            const ShimmerBox(width: 48, height: 18)
          else
            Text(
              value!,
              style: context.texts.titleMedium?.copyWith(fontWeight: FontWeight.w700),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          const SizedBox(height: 2),
          Text(
            label,
            style: context.texts.labelSmall
                ?.copyWith(color: context.scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}
