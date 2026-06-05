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

/// A glowing, claimable daily-bonus glass card. When available it haloes a
/// gift glyph (a slow breathing bloom) and offers "Забрать"; once claimed it
/// settles into a calm "приходите завтра" state. Claiming opens the coins page.
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
      glowStrength: 0.5,
      intensity: available ? 1.1 : 1,
      child: Row(
        children: [
          _BonusGlyph(available: available),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        available ? 'Ежедневный бонус' : 'Бонус получен',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: context.texts.titleMedium,
                      ),
                    ),
                    if (available) ...[
                      const SizedBox(width: AppSpacing.sm),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.sm, vertical: 2),
                        decoration: BoxDecoration(
                          borderRadius: AppRadii.brPill,
                          color: colors.warning.withValues(alpha: 0.16),
                          border: Border.all(
                              color: colors.warning.withValues(alpha: 0.3)),
                        ),
                        child: Text(
                          'НОВОЕ',
                          style: AppTypography.eyebrow(
                              fontSize: 9, color: colors.warning),
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 3),
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
              glow: true,
              gradientColors: [colors.warning, colors.neonMagenta],
              onPressed: () {
                ref.read(dailyBonusProvider.notifier).claim();
                context.go(AppRoutes.coins);
              },
            )
          else
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: colors.success.withValues(alpha: 0.14),
                border:
                    Border.all(color: colors.success.withValues(alpha: 0.3)),
              ),
              child: Icon(Icons.done_rounded, color: colors.success, size: 20),
            ),
        ],
      ),
    );
  }
}

/// The bonus glyph: a gradient gift chip that gently breathes a warm halo while
/// the bonus is claimable; a flat "checked" chip once it's been taken.
class _BonusGlyph extends StatefulWidget {
  const _BonusGlyph({required this.available});

  final bool available;

  @override
  State<_BonusGlyph> createState() => _BonusGlyphState();
}

class _BonusGlyphState extends State<_BonusGlyph>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2200),
  );

  @override
  void initState() {
    super.initState();
    _sync();
  }

  @override
  void didUpdateWidget(covariant _BonusGlyph old) {
    super.didUpdateWidget(old);
    if (old.available != widget.available) _sync();
  }

  void _sync() {
    final reduceMotion =
        MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    if (widget.available && !reduceMotion) {
      _controller.repeat(reverse: true);
    } else {
      _controller.stop();
      _controller.value = 0;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;

    final chip = Container(
      width: 54,
      height: 54,
      decoration: BoxDecoration(
        borderRadius: AppRadii.brLg,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: widget.available
              ? [colors.warning, colors.neonMagenta]
              : [
                  context.scheme.surfaceContainerHighest,
                  context.scheme.surfaceContainerHighest,
                ],
        ),
      ),
      child: Icon(
        widget.available
            ? Icons.card_giftcard_rounded
            : Icons.check_circle_outline_rounded,
        size: 27,
        color: widget.available ? Colors.white : context.scheme.onSurfaceVariant,
      ),
    );

    if (!widget.available) return chip;

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final t = _controller.value;
        return DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: AppRadii.brLg,
            boxShadow:
                AppShadows.glow(colors.warning, strength: 0.5 + t * 0.6),
          ),
          child: child,
        );
      },
      child: chip,
    );
  }
}
