/// Mirrors `packages/shared-types/src/cosmetics.ts`.
///
/// Profile-cover cosmetics — the single source of truth shared by the API
/// (catalogue + purchase/active validation) and every client renderer. A cover
/// is a small STABLE ENUM id (NOT a free-form URL); the same id maps to a
/// hand-built layered visual on each surface (see `CoverPreset` in the profile
/// feature for the mobile gradient presets).
///
/// `aurora` is the DEFAULT (reproduces the historical hero gradient).
library;

/// The 10 stable cover ids, ascending by visual richness. Order here is also
/// the catalogue order (free first, then the price ladder).
const List<String> kCoverIds = [
  'aurora',
  'graphite',
  'sunset',
  'mint',
  'mesh',
  'noir',
  'bubbles',
  'circuit',
  'galaxy',
  'prismatic',
];

/// The default cover for any profile that has not chosen one.
const String kDefaultCoverId = 'aurora';

/// Pricing/ownership tier for a cover.
enum CoverTier {
  free,
  paid;

  static CoverTier fromWire(String? raw) =>
      raw == 'paid' ? CoverTier.paid : CoverTier.free;
}

/// Catalogue contract for a single cover (`profileCoverSchema`). `name` is a
/// display label; `priceCoins` is `0` for free covers.
class ProfileCover {
  const ProfileCover({
    required this.id,
    required this.name,
    required this.tier,
    required this.priceCoins,
  });

  final String id;
  final String name;
  final CoverTier tier;
  final int priceCoins;

  bool get isFree => tier == CoverTier.free;

  factory ProfileCover.fromJson(Map<String, dynamic> json) => ProfileCover(
        id: json['id'] as String? ?? kDefaultCoverId,
        name: json['name'] as String? ?? '',
        tier: CoverTier.fromWire(json['tier'] as String?),
        priceCoins: (json['priceCoins'] as num?)?.toInt() ?? 0,
      );
}

/// `purchaseCoverSchema` request body (buy / set-active the caller's own cover).
class PurchaseCoverDto {
  const PurchaseCoverDto({required this.coverId});

  final String coverId;

  Map<String, dynamic> toJson() => {'coverId': coverId};
}

/// `coverInventorySchema` — the caller's cover inventory: the active cover and
/// the full owned set (free ids ∪ purchased ids).
class CoverInventory {
  const CoverInventory({required this.active, required this.owned});

  final String active;
  final List<String> owned;

  bool owns(String coverId) => owned.contains(coverId);

  factory CoverInventory.fromJson(Map<String, dynamic> json) => CoverInventory(
        active: json['active'] as String? ?? kDefaultCoverId,
        owned: ((json['owned'] as List?) ?? const [])
            .map((e) => e as String)
            .toList(growable: false),
      );
}
