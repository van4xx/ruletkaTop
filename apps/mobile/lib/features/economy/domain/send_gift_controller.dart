import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api.dart';
import '../../../core/models/models.dart';
import '../data/economy_repository.dart';
import 'economy_providers.dart';

/// Result of a send-gift attempt, surfaced to the UI.
sealed class SendGiftResult {
  const SendGiftResult();
}

class SendGiftSuccess extends SendGiftResult {
  const SendGiftSuccess(this.transaction);
  final GiftTransaction transaction;
}

class SendGiftFailure extends SendGiftResult {
  const SendGiftFailure(this.message);
  final String message;
}

/// Drives `POST /gifts/send`. Tracks an in-flight flag for the picker's button
/// and refreshes the wallet/ledger after a successful send (gifts spend coins).
class SendGiftController extends Notifier<bool> {
  @override
  bool build() => false; // isSending

  Future<SendGiftResult> send(SendGiftDto dto) async {
    if (state) return const SendGiftFailure('Уже отправляется');
    state = true;
    try {
      final tx = await ref.read(economyRepositoryProvider).sendGift(dto);
      // A gift is a coin outflow → balance + ledger changed.
      ref.invalidate(walletProvider);
      ref.invalidate(transactionsProvider);
      return SendGiftSuccess(tx);
    } on ApiException catch (e) {
      return SendGiftFailure(e.message);
    } catch (_) {
      return const SendGiftFailure('Не удалось отправить подарок');
    } finally {
      state = false;
    }
  }
}

final sendGiftControllerProvider =
    NotifierProvider.autoDispose<SendGiftController, bool>(
  SendGiftController.new,
);
