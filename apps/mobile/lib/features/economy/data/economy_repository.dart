import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api.dart';
import '../../../core/di/di.dart';
import '../../../core/models/models.dart';

/// Thin repository over the economy + payments endpoints (declared on
/// [ApiEndpoints]). Keeps feature controllers/providers from poking at the raw
/// [ApiClient] and gives one place to evolve caching/transforms.
///
/// Endpoints covered:
///  * Wallet — `GET /wallet`, `GET /wallet/transactions`.
///  * Coins  — `GET /coin-packages`, `POST /payments/coins/checkout`.
///  * Gifts  — `GET /gifts`, `POST /gifts/send`.
///  * Top    — `GET /top`, `POST /top/purchase`.
///  * Premium— `GET /premium/plans`, `POST /premium/subscribe`,
///             `POST /premium/cancel`.
class EconomyRepository {
  EconomyRepository(this._api);

  final ApiClient _api;

  // ── Wallet ──
  Future<Wallet> wallet() => _api.wallet();

  Future<Paginated<CoinTransaction>> transactions({String? cursor, int? limit}) =>
      _api.transactions(cursor: cursor, limit: limit);

  // ── Coins / payments ──
  Future<List<CoinPackage>> coinPackages() => _api.coinPackages();

  Future<CheckoutWidgetParams> coinsCheckout(String packageCode) =>
      _api.coinsCheckout(packageCode);

  // ── Gifts ──
  Future<List<Gift>> gifts() => _api.gifts();

  Future<GiftTransaction> sendGift(SendGiftDto dto) => _api.sendGift(dto);

  // ── Top feed ──
  Future<List<TopPlacement>> topFeed() => _api.topFeed();

  Future<TopPlacement> purchaseTop(TopPurchaseDto dto) => _api.purchaseTop(dto);

  // ── Premium ──
  Future<List<PremiumPlan>> premiumPlans() => _api.premiumPlans();

  Future<Subscription> subscribe(String planCode) => _api.subscribe(planCode);

  Future<Subscription> cancelSubscription() => _api.cancelSubscription();
}

/// The economy repository, built on the shared [apiClientProvider].
final economyRepositoryProvider = Provider<EconomyRepository>((ref) {
  return EconomyRepository(ref.watch(apiClientProvider));
});
