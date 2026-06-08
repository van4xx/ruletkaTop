import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../economy_format.dart';
import 'rarity_style.dart';

/// A single gift tile: the animated/static media on a rarity-tinted backdrop
/// (with a rarity inset ring + corner glow), the title, a coin price and a
/// premium-lock affordance. Tapping selects it (the parent opens the send
/// flow). Used in the catalog grid and the picker. Mirrors the web's
/// rarity-glow `GiftCard`.
class GiftCard extends StatelessWidget {
  const GiftCard({
    super.key,
    required this.gift,
    required this.onTap,
    this.locked = false,
    this.selected = false,
    this.compact = false,
  });

  final Gift gift;
  final VoidCallback onTap;

  /// Premium-only gift while the viewer is not premium (visually gated; the
  /// server enforces the rule too).
  final bool locked;

  /// Highlighted (e.g. chosen in the picker).
  final bool selected;

  /// Tighter layout for the bottom-sheet picker.
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final style = RarityStyle.of(context, gift.rarity);
    final colors = context.colors;
    final scheme = context.scheme;

    return GlassCard(
      padding: EdgeInsets.all(compact ? AppSpacing.sm : AppSpacing.md),
      borderRadius: AppRadii.brXl,
      onTap: onTap,
      glowColor: selected ? style.color : null,
      glowStrength: 0.7,
      intensity: selected ? 1.2 : 1,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          AspectRatio(
            aspectRatio: 1,
            child: Stack(
              fit: StackFit.expand,
              children: [
                DecoratedBox(
                  decoration: BoxDecoration(
                    borderRadius: AppRadii.brLg,
                    gradient: RadialGradient(
                      center: const Alignment(0, -0.2),
                      radius: 0.9,
                      colors: [
                        style.color.withValues(alpha: 0.26),
                        style.color.withValues(alpha: 0.05),
                      ],
                    ),
                    border: Border.all(
                      color: selected
                          ? style.color
                          : style.color.withValues(alpha: 0.32),
                      width: selected ? 1.6 : 1,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: style.color.withValues(
                          alpha: selected ? 0.35 : 0.16,
                        ),
                        blurRadius: selected ? 18 : 12,
                        spreadRadius: -6,
                      ),
                    ],
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.sm),
                    child: _GiftMedia(gift: gift, tint: style.color),
                  ),
                ),
                if (locked)
                  Positioned(
                    top: 6,
                    right: 6,
                    child: Container(
                      padding: const EdgeInsets.all(5),
                      decoration: BoxDecoration(
                        color: colors.warning.withValues(alpha: 0.22),
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: colors.warning.withValues(alpha: 0.5),
                        ),
                      ),
                      child: Icon(
                        Icons.workspace_premium_rounded,
                        size: 13,
                        color: colors.warning,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          SizedBox(height: compact ? AppSpacing.xs : AppSpacing.sm),
          Text(
            gift.title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: context.texts.labelMedium?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 2),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                Icons.monetization_on_rounded,
                size: 13,
                color: colors.warning,
              ),
              const SizedBox(width: 3),
              Text(
                EconomyFormat.number(gift.priceCoins),
                style: AppTypography.stat(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: scheme.onSurface,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Renders the gift media. `animationUrl` may point to an image (png/webp/gif)
/// — rendered via `cached_network_image`. Lottie/JSON isn't supported by the
/// declared deps, so a rarity-tinted glyph stands in as a graceful fallback.
class _GiftMedia extends StatelessWidget {
  const _GiftMedia({required this.gift, required this.tint});

  final Gift gift;
  final Color tint;

  static const _imageExt = ['.png', '.webp', '.gif', '.jpg', '.jpeg'];

  bool get _isImage {
    final url = gift.animationUrl.toLowerCase();
    return _imageExt.any(url.contains);
  }

  @override
  Widget build(BuildContext context) {
    if (gift.animationUrl.isEmpty || !_isImage) {
      return Center(
        child: Icon(Icons.card_giftcard_rounded, size: 40, color: tint),
      );
    }
    // Cap the decode to the painted box in physical pixels so a large source
    // PNG/WEBP isn't decoded to a full-res ARGB bitmap for a small grid tile.
    // The tile is bounded by an AspectRatio(1) cell; 200dp is a safe ceiling for
    // any realistic catalog/picker column. `BoxFit.contain` is visually
    // identical at this cap.
    final cacheSide =
        (200 * MediaQuery.devicePixelRatioOf(context)).round();
    return CachedNetworkImage(
      imageUrl: gift.animationUrl,
      fit: BoxFit.contain,
      memCacheWidth: cacheSide,
      memCacheHeight: cacheSide,
      placeholder: (_, _) => Center(
        child: Icon(
          Icons.card_giftcard_outlined,
          size: 32,
          color: tint.withValues(alpha: 0.5),
        ),
      ),
      errorWidget: (_, _, _) => Center(
        child: Icon(Icons.card_giftcard_rounded, size: 40, color: tint),
      ),
    );
  }
}
