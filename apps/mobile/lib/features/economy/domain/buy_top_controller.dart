import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api.dart';
import '../../../core/models/models.dart';
import '../data/economy_repository.dart';
import 'economy_providers.dart';

/// Result of a Top-placement purchase.
sealed class BuyTopResult {
  const BuyTopResult();
}

class BuyTopSuccess extends BuyTopResult {
  const BuyTopSuccess(this.placement);
  final TopPlacement placement;
}

class BuyTopFailure extends BuyTopResult {
  const BuyTopFailure(this.message);
  final String message;
}

/// Drives `POST /top/purchase` (bid coins for a lane placement — more coins ⇒
/// higher rank). Refreshes the wallet + Top feed on success.
class BuyTopController extends Notifier<bool> {
  @override
  bool build() => false; // isPurchasing

  Future<BuyTopResult> purchase(TopPurchaseDto dto) async {
    if (state) return const BuyTopFailure('Уже выполняется');
    state = true;
    try {
      final placement = await ref.read(economyRepositoryProvider).purchaseTop(dto);
      ref.invalidate(walletProvider);
      ref.invalidate(transactionsProvider);
      ref.invalidate(topFeedProvider);
      return BuyTopSuccess(placement);
    } on ApiException catch (e) {
      return BuyTopFailure(e.message);
    } catch (_) {
      return const BuyTopFailure('Не удалось купить место');
    } finally {
      state = false;
    }
  }
}

final buyTopControllerProvider =
    NotifierProvider.autoDispose<BuyTopController, bool>(BuyTopController.new);
