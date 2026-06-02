import '../../../core/models/models.dart';

/// A received gift, aggregated for the showcase: the catalog [gift] (resolved
/// from the gift id), how many of this gift the user has received ([count]),
/// and the total coin value across those copies ([valueCoins]).
class AggregatedGift {
  const AggregatedGift({
    required this.giftId,
    required this.title,
    required this.animationUrl,
    required this.rarity,
    required this.count,
    required this.valueCoins,
  });

  final String giftId;
  final String title;
  final String animationUrl;
  final Rarity rarity;
  final int count;
  final int valueCoins;
}

/// The whole received-gifts showcase for a profile: the aggregated tiles
/// (rarest + most valuable first), the number of distinct gifts and the total
/// coin value across ALL received gifts (incl. duplicates).
class GiftShowcase {
  const GiftShowcase({
    required this.tiles,
    required this.totalValueCoins,
  });

  final List<AggregatedGift> tiles;
  final int totalValueCoins;

  int get distinctCount => tiles.length;
  bool get isEmpty => tiles.isEmpty;

  static const empty = GiftShowcase(tiles: [], totalValueCoins: 0);

  /// Build a showcase from the raw received-gift transactions joined with the
  /// gift [catalog] (by gift id). Unknown gifts (absent from the catalog) still
  /// count toward totals using the transaction's recorded price, with a neutral
  /// placeholder tile so the value is never silently dropped.
  factory GiftShowcase.build(
    List<GiftTransaction> received,
    List<Gift> catalog,
  ) {
    final byId = {for (final g in catalog) g.id: g};

    final agg = <String, _MutableAgg>{};
    var total = 0;
    for (final tx in received) {
      final gift = byId[tx.giftId];
      final price = gift?.priceCoins ?? tx.priceCoins;
      total += price;
      final existing = agg[tx.giftId];
      if (existing != null) {
        existing.count += 1;
        existing.valueCoins += price;
      } else {
        agg[tx.giftId] = _MutableAgg(
          title: gift?.title ?? 'Подарок',
          animationUrl: gift?.animationUrl ?? '',
          rarity: gift?.rarity ?? Rarity.common,
          count: 1,
          valueCoins: price,
        );
      }
    }

    const rarityOrder = {
      Rarity.legendary: 3,
      Rarity.epic: 2,
      Rarity.rare: 1,
      Rarity.common: 0,
    };

    final tiles = agg.entries
        .map((e) => AggregatedGift(
              giftId: e.key,
              title: e.value.title,
              animationUrl: e.value.animationUrl,
              rarity: e.value.rarity,
              count: e.value.count,
              valueCoins: e.value.valueCoins,
            ))
        .toList()
      ..sort((a, b) {
        final byRarity =
            (rarityOrder[b.rarity] ?? 0).compareTo(rarityOrder[a.rarity] ?? 0);
        if (byRarity != 0) return byRarity;
        return b.valueCoins.compareTo(a.valueCoins);
      });

    return GiftShowcase(tiles: tiles, totalValueCoins: total);
  }
}

class _MutableAgg {
  _MutableAgg({
    required this.title,
    required this.animationUrl,
    required this.rarity,
    required this.count,
    required this.valueCoins,
  });

  final String title;
  final String animationUrl;
  final Rarity rarity;
  int count;
  int valueCoins;
}
