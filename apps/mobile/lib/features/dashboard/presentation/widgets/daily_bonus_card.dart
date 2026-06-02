import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/di/di.dart';
import '../../../../core/router/routes.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';

/// Local daily-bonus state. The backend exposes no bonus endpoint, so — exactly
/// like the web's client widget — this is a lightweight engagement affordance
/// persisted locally: it records the date (yyyy-mm-dd) of the last claim and
/// considers the bonus "available" once per calendar day. Claiming routes the
/// user to the coins page (where real top-ups happen).
class DailyBonusState {
  const DailyBonusState({required this.claimedToday, required this.loaded});

  /// True when today's bonus has already been claimed.
  final bool claimedToday;

  /// False until the persisted value has been read once (avoids a flash).
  final bool loaded;

  bool get available => loaded && !claimedToday;

  DailyBonusState copyWith({bool? claimedToday, bool? loaded}) =>
      DailyBonusState(
        claimedToday: claimedToday ?? this.claimedToday,
        loaded: loaded ?? this.loaded,
      );
}

class DailyBonusController extends Notifier<DailyBonusState> {
  static const _key = 'ruletka_daily_bonus_claimed_date';

  FlutterSecureStorage get _storage => ref.read(secureStorageProvider);

  @override
  DailyBonusState build() {
    // Kick off the async read; state flips to loaded when it returns.
    Future.microtask(_load);
    return const DailyBonusState(claimedToday: false, loaded: false);
  }

  static String _today() {
    final now = DateTime.now();
    final mm = now.month.toString().padLeft(2, '0');
    final dd = now.day.toString().padLeft(2, '0');
    return '${now.year}-$mm-$dd';
  }

  Future<void> _load() async {
    String? saved;
    try {
      saved = await _storage.read(key: _key);
    } catch (_) {
      saved = null;
    }
    state = DailyBonusState(claimedToday: saved == _today(), loaded: true);
  }

  /// Mark today's bonus claimed (idempotent within the day).
  Future<void> claim() async {
    if (state.claimedToday) return;
    state = state.copyWith(claimedToday: true);
    try {
      await _storage.write(key: _key, value: _today());
    } catch (_) {
      // Best-effort; a storage failure just means the streak won't persist.
    }
  }
}

final dailyBonusProvider =
    NotifierProvider<DailyBonusController, DailyBonusState>(
        DailyBonusController.new);

/// A compact, eye-catching daily-bonus card. When available it pulses a gift
/// glyph and offers "Забрать"; once claimed it switches to a calm "приходите
/// завтра" state. Claiming opens the coins page.
class DailyBonusCard extends ConsumerWidget {
  const DailyBonusCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = context.colors;
    final bonus = ref.watch(dailyBonusProvider);
    final available = bonus.available;

    return GlassCard(
      padding: const EdgeInsets.all(AppSpacing.lg),
      glowColor: available ? colors.warning : null,
      glowStrength: 0.4,
      child: Row(
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              borderRadius: AppRadii.brLg,
              gradient: LinearGradient(
                colors: available
                    ? [colors.warning, colors.neonMagenta]
                    : [
                        context.scheme.surfaceContainerHighest,
                        context.scheme.surfaceContainerHighest,
                      ],
              ),
            ),
            child: Icon(
              available
                  ? Icons.card_giftcard_rounded
                  : Icons.check_circle_outline_rounded,
              size: 26,
              color: available ? Colors.white : context.scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  available ? 'Ежедневный бонус' : 'Бонус получен',
                  style: context.texts.titleSmall,
                ),
                const SizedBox(height: 2),
                Text(
                  available
                      ? 'Заберите монеты за вход сегодня'
                      : 'Возвращайтесь завтра за новым бонусом',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: context.texts.bodySmall
                      ?.copyWith(color: context.scheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          if (available)
            GradientButton(
              label: 'Забрать',
              fullWidth: false,
              height: 40,
              glow: false,
              gradientColors: [colors.warning, colors.neonMagenta],
              onPressed: () {
                ref.read(dailyBonusProvider.notifier).claim();
                context.go(AppRoutes.coins);
              },
            )
          else
            Icon(Icons.done_rounded, color: colors.success),
        ],
      ),
    );
  }
}
