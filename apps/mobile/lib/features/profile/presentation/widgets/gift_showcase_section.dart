import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../../../economy/presentation/economy_format.dart';
import '../../../economy/presentation/widgets/rarity_style.dart';
import '../../domain/received_gift.dart';
import '../profile_providers.dart';

/// The received-gifts showcase for a profile (own or public), driven by
/// [giftShowcaseProvider]. Renders a header with the total coin value and a
/// horizontal rail of rarity-tinted gift tiles (rarest + most valuable first),
/// with graceful loading / empty / error states.
class GiftShowcaseSection extends ConsumerWidget {
  const GiftShowcaseSection({
    super.key,
    required this.userId,
    this.emptyMessage = 'Пока нет подарков.',
  });

  final String userId;

  /// Message for the empty state (differs for own vs. public profile).
  final String emptyMessage;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final showcaseAsync = ref.watch(giftShowcaseProvider(userId));

    return showcaseAsync.when(
      loading: () => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: const [
          SectionHeader(title: 'Полученные подарки'),
          SizedBox(height: AppSpacing.xs),
          _ShowcaseSkeleton(),
        ],
      ),
      error: (_, _) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SectionHeader(title: 'Полученные подарки'),
          GlassCard(
            child: Row(
              children: [
                Icon(Icons.error_outline_rounded,
                    size: 20, color: context.scheme.error),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Text(
                    'Не удалось загрузить подарки',
                    style: context.texts.bodyMedium?.copyWith(
                        color: context.scheme.onSurfaceVariant),
                  ),
                ),
                TextButton(
                  onPressed: () =>
                      ref.invalidate(giftShowcaseProvider(userId)),
                  child: const Text('Повторить'),
                ),
              ],
            ),
          ),
        ],
      ),
      data: (showcase) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SectionHeader(
              title: 'Полученные подарки',
              trailing: showcase.isEmpty
                  ? null
                  : _ValuePill(value: showcase.totalValueCoins),
            ),
            const SizedBox(height: AppSpacing.xs),
            if (showcase.isEmpty)
              GlassCard(
                padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.lg, vertical: AppSpacing.xl),
                child: Row(
                  children: [
                    Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        borderRadius: AppRadii.brMd,
                        color: context.colors.neonViolet
                            .withValues(alpha: 0.14),
                      ),
                      child: Icon(Icons.card_giftcard_rounded,
                          size: 22, color: context.colors.neonViolet),
                    ),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Text(
                        emptyMessage,
                        style: context.texts.bodyMedium?.copyWith(
                            color: context.scheme.onSurfaceVariant),
                      ),
                    ),
                  ],
                ),
              )
            else
              SizedBox(
                height: 150,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: EdgeInsets.zero,
                  itemCount: showcase.tiles.length,
                  separatorBuilder: (_, _) =>
                      const SizedBox(width: AppSpacing.md),
                  itemBuilder: (_, i) =>
                      _GiftTile(gift: showcase.tiles[i]),
                ),
              ),
          ],
        );
      },
    );
  }
}

/// A pill summarising the total coin value of all received gifts.
class _ValuePill extends StatelessWidget {
  const _ValuePill({required this.value});

  final int value;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      padding:
          const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 5),
      decoration: BoxDecoration(
        borderRadius: AppRadii.brPill,
        color: colors.warning.withValues(alpha: 0.14),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.monetization_on_rounded, size: 14, color: colors.warning),
          const SizedBox(width: 4),
          Text(
            EconomyFormat.number(value),
            style: context.texts.labelMedium
                ?.copyWith(color: colors.warning, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}

/// A single received-gift tile: rarity-tinted media with a "×count" badge, the
/// title and its aggregated coin value.
class _GiftTile extends StatelessWidget {
  const _GiftTile({required this.gift});

  final AggregatedGift gift;

  static const _imageExt = ['.png', '.webp', '.gif', '.jpg', '.jpeg'];

  bool get _isImage {
    final url = gift.animationUrl.toLowerCase();
    return url.isNotEmpty && _imageExt.any(url.contains);
  }

  @override
  Widget build(BuildContext context) {
    final style = RarityStyle.of(context, gift.rarity);
    final colors = context.colors;

    return SizedBox(
      width: 116,
      child: GlassCard(
        padding: const EdgeInsets.all(AppSpacing.sm),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
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
                        colors: [
                          style.color.withValues(alpha: 0.22),
                          style.color.withValues(alpha: 0.04),
                        ],
                      ),
                      border: Border.all(
                          color: style.color.withValues(alpha: 0.25)),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(AppSpacing.sm),
                      child: _isImage
                          ? CachedNetworkImage(
                              imageUrl: gift.animationUrl,
                              fit: BoxFit.contain,
                              // Cap the decode to the painted box in physical
                              // pixels: the tile is a fixed 116dp-wide card with
                              // sm padding, so ~100dp is a safe ceiling for this
                              // AspectRatio(1) media box. `BoxFit.contain` is
                              // visually identical, but a large source PNG no
                              // longer decodes to a full-res ARGB bitmap.
                              memCacheWidth: (100 *
                                      MediaQuery.devicePixelRatioOf(context))
                                  .round(),
                              memCacheHeight: (100 *
                                      MediaQuery.devicePixelRatioOf(context))
                                  .round(),
                              placeholder: (_, _) => Center(
                                child: Icon(Icons.card_giftcard_outlined,
                                    size: 26,
                                    color:
                                        style.color.withValues(alpha: 0.5)),
                              ),
                              errorWidget: (_, _, _) => Center(
                                child: Icon(Icons.card_giftcard_rounded,
                                    size: 32, color: style.color),
                              ),
                            )
                          : Center(
                              child: Icon(Icons.card_giftcard_rounded,
                                  size: 32, color: style.color),
                            ),
                    ),
                  ),
                  if (gift.count > 1)
                    Positioned(
                      top: 4,
                      right: 4,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          borderRadius: AppRadii.brPill,
                          color: colors.scrim,
                        ),
                        child: Text(
                          '×${gift.count}',
                          style: context.texts.labelSmall?.copyWith(
                              color: Colors.white,
                              fontWeight: FontWeight.w700),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              gift.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: context.texts.labelMedium
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 2),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.monetization_on_rounded,
                    size: 12, color: colors.warning),
                const SizedBox(width: 3),
                Text(
                  EconomyFormat.number(gift.valueCoins),
                  style: context.texts.labelSmall?.copyWith(
                      color: context.scheme.onSurface,
                      fontWeight: FontWeight.w700),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _ShowcaseSkeleton extends StatelessWidget {
  const _ShowcaseSkeleton();

  @override
  Widget build(BuildContext context) {
    return LoadingShimmer(
      child: SizedBox(
        height: 150,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: EdgeInsets.zero,
          itemCount: 4,
          separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.md),
          itemBuilder: (_, _) => Container(
            width: 116,
            decoration: BoxDecoration(
              borderRadius: AppRadii.brXl,
              color: context.scheme.surfaceContainerHighest,
            ),
          ),
        ),
      ),
    );
  }
}
