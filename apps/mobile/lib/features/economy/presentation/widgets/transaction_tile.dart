import 'package:flutter/material.dart';

import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../economy_format.dart';

/// A single coin-ledger row: a type icon, a human label + date, the signed
/// delta (green for inflow, muted for outflow) and the running balance.
class TransactionTile extends StatelessWidget {
  const TransactionTile({super.key, required this.tx});

  final CoinTransaction tx;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final isInflow = tx.delta >= 0;
    final (icon, tint) = _glyph(context);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              borderRadius: AppRadii.brMd,
              color: tint.withValues(alpha: 0.15),
              border: Border.all(color: tint.withValues(alpha: 0.22)),
            ),
            child: Icon(icon, size: 20, color: tint),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  EconomyFormat.txTypeLabel(tx.type),
                  style: context.texts.titleSmall,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  EconomyFormat.dateTime(tx.createdAt),
                  style: context.texts.bodySmall?.copyWith(
                    color: context.scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                EconomyFormat.signed(tx.delta),
                style: AppTypography.stat(
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                  color: isInflow ? colors.success : context.scheme.onSurface,
                ),
              ),
              const SizedBox(height: 2),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.monetization_on_rounded,
                    size: 11,
                    color: context.scheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: 3),
                  Text(
                    EconomyFormat.number(tx.balanceAfter),
                    style: context.texts.labelSmall?.copyWith(
                      color: context.scheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }

  (IconData, Color) _glyph(BuildContext context) {
    final colors = context.colors;
    return switch (tx.type) {
      CoinTxType.purchase => (Icons.add_card_rounded, colors.success),
      CoinTxType.giftIn => (Icons.card_giftcard_rounded, colors.neonCyan),
      CoinTxType.giftOut => (Icons.redeem_rounded, colors.neonMagenta),
      CoinTxType.top => (Icons.emoji_events_rounded, colors.warning),
      CoinTxType.bonus => (Icons.auto_awesome_rounded, colors.neonViolet),
      CoinTxType.refund => (Icons.undo_rounded, colors.neonCyan),
    };
  }
}
