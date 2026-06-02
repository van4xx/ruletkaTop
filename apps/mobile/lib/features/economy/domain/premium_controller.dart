import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api.dart';
import '../../../core/di/di.dart';
import '../../../core/models/models.dart';
import '../data/cloudpayments.dart';
import '../data/economy_repository.dart';
import '../presentation/cloudpayments_webview.dart';
import 'economy_providers.dart';

/// The caller's current subscription.
///
/// There is no `GET /premium/subscription` endpoint; the available read path is
/// `POST /premium/subscribe`, which VALIDATES a plan and RETURNS the current
/// subscription WITHOUT granting anything (entitlement only comes from the
/// CloudPayments recurrent webhook). We probe with the first plan's code, the
/// same approach the web takes. Only runs when authenticated.
final subscriptionProvider = FutureProvider.autoDispose<Subscription?>((ref) async {
  final user = ref.watch(currentUserProvider);
  if (user == null) return null;
  final plans = await ref.watch(premiumPlansProvider.future);
  final probe = plans.isNotEmpty ? plans.first.code : null;
  if (probe == null) return null;
  return ref.read(economyRepositoryProvider).subscribe(probe);
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
/// Subscribe: register intent (`POST /premium/subscribe`) → open the recurrent
/// CloudPayments sheet (client-supplied public id, plan-derived cadence) → show
/// pending (entitlement activates on the webhook).
class PremiumController extends Notifier<PremiumState> {
  @override
  PremiumState build() => const PremiumState();

  void reset() => state = const PremiumState();

  Future<void> subscribe(BuildContext context, PremiumPlan plan) async {
    if (state.isBusy) return;

    if (!CloudPayments.hasPublicId) {
      state = PremiumState(
        phase: SubscribePhase.error,
        activePlan: plan,
        error:
            'Платёжный виджет не настроен (нет CLOUDPAYMENTS_PUBLIC_ID).',
      );
      return;
    }

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

    // 1) Register intent (backend validates the plan + returns the record).
    try {
      await ref.read(economyRepositoryProvider).subscribe(plan.code);
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

    // 2) Open the recurrent CloudPayments charge.
    state = state.copyWith(phase: SubscribePhase.widget);
    final result = await CloudPaymentsWebView.show(
      context,
      CloudPaymentsCharge.premium(
        publicId: CloudPayments.publicId,
        plan: plan,
        userId: userId,
      ),
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
