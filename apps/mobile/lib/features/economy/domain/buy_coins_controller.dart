import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api.dart';
import '../../../core/models/models.dart';
import '../data/cloudpayments.dart';
import '../presentation/cloudpayments_webview.dart';
import '../data/economy_repository.dart';
import 'economy_providers.dart';

/// UI phase of the coin-purchase flow (mirrors the web's `CheckoutPhase`):
///  * idle      — nothing in progress.
///  * starting  — POST /payments/coins/checkout in flight.
///  * widget     — CloudPayments sheet is open.
///  * pending    — charge captured; awaiting the webhook credit (we re-fetch).
///  * credited   — balance refetched after a successful charge.
///  * error      — checkout failed or the charge was declined.
enum CheckoutPhase { idle, starting, widget, pending, credited, error }

/// State for the buy-coins flow.
class BuyCoinsState {
  const BuyCoinsState({
    this.phase = CheckoutPhase.idle,
    this.activePackage,
    this.error,
  });

  final CheckoutPhase phase;
  final CoinPackage? activePackage;
  final String? error;

  bool get isBusy =>
      phase == CheckoutPhase.starting ||
      phase == CheckoutPhase.widget ||
      phase == CheckoutPhase.pending;

  BuyCoinsState copyWith({
    CheckoutPhase? phase,
    CoinPackage? activePackage,
    String? error,
  }) =>
      BuyCoinsState(
        phase: phase ?? this.phase,
        activePackage: activePackage ?? this.activePackage,
        error: error,
      );
}

/// Orchestrates a coin purchase end-to-end:
///   1. POST /payments/coins/checkout → server-minted widget params.
///   2. Open the CloudPayments sheet ([CloudPaymentsWebView]).
///   3. On a captured charge: show pending + refetch the wallet (the coin
///      credit is applied by the backend webhook).
class BuyCoinsController extends Notifier<BuyCoinsState> {
  @override
  BuyCoinsState build() => const BuyCoinsState();

  /// Reset to idle (e.g. dismissing the status dialog).
  void reset() => state = const BuyCoinsState();

  /// Begin purchasing [pkg]. Needs a [context] to present the payment sheet.
  Future<void> buy(BuildContext context, CoinPackage pkg) async {
    if (state.isBusy) return;
    state = BuyCoinsState(phase: CheckoutPhase.starting, activePackage: pkg);

    final CheckoutWidgetParams params;
    try {
      params = await ref.read(economyRepositoryProvider).coinsCheckout(pkg.code);
    } on ApiException catch (e) {
      state = state.copyWith(phase: CheckoutPhase.error, error: e.message);
      return;
    } catch (_) {
      state = state.copyWith(
        phase: CheckoutPhase.error,
        error: 'Не удалось начать оплату',
      );
      return;
    }

    if (!context.mounted) {
      state = const BuyCoinsState();
      return;
    }

    state = state.copyWith(phase: CheckoutPhase.widget);
    final result = await CloudPaymentsWebView.show(
      context,
      CloudPaymentsCharge.coins(params),
    );

    switch (result?.event) {
      case CloudPaymentsEvent.success:
        // Charge captured; the credit arrives via webhook. Show pending while
        // we re-fetch the balance, then settle on credited.
        state = state.copyWith(phase: CheckoutPhase.pending);
        await _refetchWallet();
        state = state.copyWith(phase: CheckoutPhase.credited);
      case CloudPaymentsEvent.fail:
        state = state.copyWith(
          phase: CheckoutPhase.error,
          error: result?.reason ?? 'Платёж не прошёл',
        );
      case CloudPaymentsEvent.close:
      case CloudPaymentsEvent.complete:
      case null:
        // User dismissed the sheet — quietly return to idle.
        state = const BuyCoinsState();
    }
  }

  Future<void> _refetchWallet() async {
    ref.invalidate(walletProvider);
    ref.invalidate(transactionsProvider);
    // Give the provider a beat to refetch so the credited UI reflects reality;
    // swallow a transient refetch error (the screen still shows the dialog).
    try {
      await ref.read(walletProvider.future);
    } catch (_) {
      // ignored — balance will reconcile on the next screen visit
    }
  }
}

final buyCoinsControllerProvider =
    NotifierProvider.autoDispose<BuyCoinsController, BuyCoinsState>(
  BuyCoinsController.new,
);
