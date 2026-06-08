import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api.dart';
import '../../../core/di/di.dart';
import '../../../core/models/models.dart';
import '../data/cloudpayments.dart';
import '../data/economy_repository.dart';
import '../presentation/cloudpayments_webview.dart';

/// The caller's current subscription.
///
/// A pure read via `GET /premium/subscription` (no side effects) — replacing the
/// old `POST /premium/subscribe` probe. The server returns a synthetic `none`
/// record when the caller has never subscribed. Only runs when authenticated.
final subscriptionProvider = FutureProvider.autoDispose<Subscription?>((ref) async {
  final user = ref.watch(currentUserProvider);
  if (user == null) return null;
  return ref.read(economyRepositoryProvider).premiumSubscription();
});

/// UI phase of the subscribe flow (mirrors the web's `SubscribePhase`).
enum SubscribePhase { idle, starting, widget, pending, active, error }

class PremiumState {
  const PremiumState({
    this.phase = SubscribePhase.idle,
    this.activePlan,
    this.error,
  });

  final SubscribePhase phase;
  final PremiumPlan? activePlan;
  final String? error;

  bool get isBusy =>
      phase == SubscribePhase.starting ||
      phase == SubscribePhase.widget ||
      phase == SubscribePhase.pending;

  PremiumState copyWith({
    SubscribePhase? phase,
    PremiumPlan? activePlan,
    String? error,
  }) =>
      PremiumState(
        phase: phase ?? this.phase,
        activePlan: activePlan ?? this.activePlan,
        error: error,
      );
}

/// Orchestrates premium subscribe + cancel.
///
/// Subscribe: get SERVER-minted CloudPayments widget params
/// (`POST /payments/premium/checkout` — the amount + recurrent descriptor are
/// fixed server-side, and a PENDING premium payment is created) → open the
/// CloudPayments sheet with those params → show pending (entitlement activates
/// on the Pay webhook).
class PremiumController extends Notifier<PremiumState> {
  @override
  PremiumState build() => const PremiumState();

  void reset() => state = const PremiumState();

  Future<void> subscribe(BuildContext context, PremiumPlan plan) async {
    if (state.isBusy) return;

    final userId = ref.read(currentUserIdProvider);
    if (userId == null) {
      state = PremiumState(
        phase: SubscribePhase.error,
        activePlan: plan,
        error: 'Войдите, чтобы оформить подписку',
      );
      return;
    }

    state = PremiumState(phase: SubscribePhase.starting, activePlan: plan);

    // 1) Server-side checkout: validates the plan, creates a PENDING premium
    //    payment and returns the CloudPayments widget params (incl. recurrent).
    final CheckoutWidgetParams params;
    try {
      params =
          await ref.read(economyRepositoryProvider).premiumCheckout(plan.code);
    } on ApiException catch (e) {
      state = state.copyWith(phase: SubscribePhase.error, error: e.message);
      return;
    } catch (_) {
      state = state.copyWith(
        phase: SubscribePhase.error,
        error: 'Не удалось оформить подписку',
      );
      return;
    }

    if (!context.mounted) {
      state = const PremiumState();
      return;
    }

    // 2) Open the CloudPayments charge with the server-minted params.
    state = state.copyWith(phase: SubscribePhase.widget);
    final result = await CloudPaymentsWebView.show(
      context,
      CloudPaymentsCharge.coins(params),
    );

    switch (result?.event) {
      case CloudPaymentsEvent.success:
        // Entitlement activates via the recurrent webhook; reflect "pending".
        state = state.copyWith(phase: SubscribePhase.pending);
        ref.invalidate(subscriptionProvider);
        state = state.copyWith(phase: SubscribePhase.active);
      case CloudPaymentsEvent.fail:
        state = state.copyWith(
          phase: SubscribePhase.error,
          error: result?.reason ?? 'Платёж не прошёл',
        );
      case CloudPaymentsEvent.close:
      case CloudPaymentsEvent.complete:
      case null:
        state = const PremiumState();
    }
  }

  /// Cancel at period end (`POST /premium/cancel`). Returns an error message on
  /// failure, or `null` on success.
  Future<String?> cancel() async {
    try {
      await ref.read(economyRepositoryProvider).cancelSubscription();
      ref.invalidate(subscriptionProvider);
      return null;
    } on ApiException catch (e) {
      return e.message;
    } catch (_) {
      return 'Не удалось отменить подписку';
    }
  }
}

final premiumControllerProvider =
    NotifierProvider.autoDispose<PremiumController, PremiumState>(
  PremiumController.new,
);
