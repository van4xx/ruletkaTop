import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/models/models.dart';
import '../../../../core/router/routes.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../../domain/buy_top_controller.dart';
import '../../domain/economy_providers.dart';
import '../../domain/top_feed_view.dart';
import '../economy_format.dart';

/// The Top-placement purchase sheet: pick a lane, a duration and a coin bid,
/// then `POST /top/purchase` via [buyTopControllerProvider]. The bid drives the
/// rank (more coins ⇒ higher), so the sheet suggests a figure that out-ranks
/// the current leader of the chosen lane.
///
/// Server constraints (mirrored client-side for a good UX, still enforced by
/// the API): a placement costs at least [minCoins] coins, and the duration is
/// 1–720 hours.
class TopPurchaseSheet extends ConsumerStatefulWidget {
  const TopPurchaseSheet({
    super.key,
    this.topLeftBid = 0,
    this.topRightBid = 0,
  });

  /// The current leader's bid in each lane (0 when empty) — used to suggest a
  /// bid that takes first place.
  final int topLeftBid;
  final int topRightBid;

  /// The server-enforced minimum placement spend (`MIN_TOP_PLACEMENT_COINS`).
  static const int minCoins = 50;

  /// Allowed duration presets in hours (all within the 1–720 server range).
  static const List<int> durations = [24, 72, 168, 720];

  static Future<void> show(
    BuildContext context, {
    int topLeftBid = 0,
    int topRightBid = 0,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) =>
          TopPurchaseSheet(topLeftBid: topLeftBid, topRightBid: topRightBid),
    );
  }

  @override
  ConsumerState<TopPurchaseSheet> createState() => _TopPurchaseSheetState();
}

class _TopPurchaseSheetState extends ConsumerState<TopPurchaseSheet> {
  TopLane _lane = TopLane.left;
  int _durationHours = 168;
  late final TextEditingController _coins;

  @override
  void initState() {
    super.initState();
    _coins = TextEditingController(text: '${_suggestedBid(_lane)}');
  }

  @override
  void dispose() {
    _coins.dispose();
    super.dispose();
  }

  int get _leaderBid =>
      _lane == TopLane.left ? widget.topLeftBid : widget.topRightBid;

  /// A bid that takes first place: just above the current leader, but never
  /// below the floor. Rounded up to a tidy figure.
  int _suggestedBid(TopLane lane) {
    final leader = lane == TopLane.left
        ? widget.topLeftBid
        : widget.topRightBid;
    if (leader <= 0) return TopPurchaseSheet.minCoins;
    final target = leader + (leader * 0.1).ceil() + 10;
    return (target / 10).ceil() * 10; // round up to nearest 10
  }

  int get _enteredCoins => int.tryParse(_coins.text.trim()) ?? 0;

  void _selectLane(TopLane lane) {
    if (lane == _lane) return;
    setState(() {
      _lane = lane;
      // Re-suggest a competitive bid for the newly-selected lane.
      final suggested = _suggestedBid(lane);
      _coins.value = TextEditingValue(
        text: '$suggested',
        selection: TextSelection.collapsed(offset: '$suggested'.length),
      );
    });
  }

  Future<void> _submit() async {
    final coins = _enteredCoins;
    final messenger = ScaffoldMessenger.of(context);

    if (coins < TopPurchaseSheet.minCoins) {
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            'Минимальная ставка — ${TopPurchaseSheet.minCoins} монет.',
          ),
        ),
      );
      return;
    }

    final result = await ref
        .read(buyTopControllerProvider.notifier)
        .purchase(
          TopPurchaseDto(
            lane: _lane,
            durationHours: _durationHours,
            coins: coins,
          ),
        );

    if (!mounted) return;
    switch (result) {
      case BuyTopSuccess():
        // The controller already refreshes wallet/feed; refresh the hydrated
        // screen feed too so the new placement appears immediately.
        ref.invalidate(topFeedViewProvider);
        Navigator.of(context).pop();
        messenger.showSnackBar(
          const SnackBar(content: Text('Готово! Вы заняли место в Топе.')),
        );
      case BuyTopFailure(:final message):
        messenger.showSnackBar(SnackBar(content: Text(message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final balance = ref.watch(coinBalanceProvider);
    final isPurchasing = ref.watch(buyTopControllerProvider);
    final coins = _enteredCoins;
    final insufficient = balance != null && coins > balance;
    final belowFloor = coins < TopPurchaseSheet.minCoins;
    final canBuy = !isPurchasing && !belowFloor && !insufficient;
    final viewInsets = MediaQuery.viewInsetsOf(context).bottom;

    return Padding(
      padding: EdgeInsets.only(bottom: viewInsets),
      child: ClipRRect(
        borderRadius: const BorderRadius.vertical(
          top: Radius.circular(AppRadii.xxl),
        ),
        child: BackdropFilter(
          filter: ImageFilter.blur(
            sigmaX: AppBlur.heavy,
            sigmaY: AppBlur.heavy,
          ),
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: context.scheme.surface.withValues(alpha: 0.86),
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(AppRadii.xxl),
              ),
              border: Border(
                top: BorderSide(
                  color: colors.glassHighlight.withValues(alpha: 0.2),
                ),
              ),
            ),
            child: SafeArea(
              top: false,
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg,
                  AppSpacing.sm,
                  AppSpacing.lg,
                  AppSpacing.lg,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Center(
                      child: Container(
                        width: 40,
                        height: 4,
                        margin: const EdgeInsets.only(bottom: AppSpacing.md),
                        decoration: BoxDecoration(
                          color: colors.glassBorder,
                          borderRadius: AppRadii.brPill,
                        ),
                      ),
                    ),
                    Row(
                      children: [
                        Container(
                          width: 38,
                          height: 38,
                          decoration: BoxDecoration(
                            borderRadius: AppRadii.brMd,
                            gradient: LinearGradient(
                              colors: [colors.warning, colors.neonMagenta],
                            ),
                            boxShadow: AppShadows.glow(
                              colors.warning,
                              strength: 0.45,
                            ),
                          ),
                          child: const Icon(
                            Icons.emoji_events_rounded,
                            color: Colors.white,
                            size: 21,
                          ),
                        ),
                        const SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: Text(
                            'Купить место в Топе',
                            style: context.texts.titleLarge,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.lg),

                    // Lane.
                    Text(
                      'Дорожка',
                      style: context.texts.labelLarge?.copyWith(
                        color: context.scheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Row(
                      children: [
                        Expanded(
                          child: _ChoiceTile(
                            label: 'Дорожка 1',
                            selected: _lane == TopLane.left,
                            accent: colors.neonViolet,
                            onTap: () => _selectLane(TopLane.left),
                          ),
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        Expanded(
                          child: _ChoiceTile(
                            label: 'Дорожка 2',
                            selected: _lane == TopLane.right,
                            accent: colors.neonCyan,
                            onTap: () => _selectLane(TopLane.right),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.lg),

                    // Duration.
                    Text(
                      'Длительность',
                      style: context.texts.labelLarge?.copyWith(
                        color: context.scheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Wrap(
                      spacing: AppSpacing.sm,
                      runSpacing: AppSpacing.sm,
                      children: [
                        for (final h in TopPurchaseSheet.durations)
                          _PillChoice(
                            label: _durationLabel(h),
                            selected: _durationHours == h,
                            onTap: () => setState(() => _durationHours = h),
                          ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.lg),

                    // Bid.
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            'Ваша ставка',
                            style: context.texts.labelLarge?.copyWith(
                              color: context.scheme.onSurfaceVariant,
                            ),
                          ),
                        ),
                        if (_leaderBid > 0)
                          Text(
                            'Лидер: ${EconomyFormat.number(_leaderBid)}',
                            style: context.texts.labelSmall?.copyWith(
                              color: context.scheme.onSurfaceVariant,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    TextField(
                      controller: _coins,
                      keyboardType: TextInputType.number,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                      onChanged: (_) => setState(() {}),
                      decoration: InputDecoration(
                        prefixIcon: Icon(
                          Icons.monetization_on_rounded,
                          color: colors.warning,
                        ),
                        suffixText: 'монет',
                        hintText: '${TopPurchaseSheet.minCoins}',
                        helperText:
                            'Минимум ${TopPurchaseSheet.minCoins} монет. Чем больше — тем выше место.',
                        errorText: belowFloor && _coins.text.isNotEmpty
                            ? 'Минимум ${TopPurchaseSheet.minCoins} монет'
                            : null,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Wrap(
                      spacing: AppSpacing.sm,
                      runSpacing: AppSpacing.sm,
                      children: [
                        for (final amount in _bidPresets())
                          ActionChip(
                            label: Text(EconomyFormat.number(amount)),
                            onPressed: () {
                              _coins.value = TextEditingValue(
                                text: '$amount',
                                selection: TextSelection.collapsed(
                                  offset: '$amount'.length,
                                ),
                              );
                              setState(() {});
                            },
                          ),
                      ],
                    ),

                    const SizedBox(height: AppSpacing.lg),

                    // Balance + insufficient hint.
                    _BalanceRow(balance: balance, insufficient: insufficient),
                    if (insufficient) ...[
                      const SizedBox(height: AppSpacing.sm),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Недостаточно монет для этой ставки.',
                              style: context.texts.bodySmall?.copyWith(
                                color: context.scheme.error,
                              ),
                            ),
                          ),
                          TextButton.icon(
                            onPressed: () {
                              Navigator.of(context).pop();
                              context.push(AppRoutes.coins);
                            },
                            icon: const Icon(Icons.add_rounded, size: 18),
                            label: const Text('Пополнить'),
                          ),
                        ],
                      ),
                    ],
                    const SizedBox(height: AppSpacing.lg),

                    GradientButton(
                      label: belowFloor || coins == 0
                          ? 'Купить место'
                          : 'Купить за ${EconomyFormat.number(coins)} монет',
                      icon: Icons.emoji_events_rounded,
                      gradientColors: [colors.warning, colors.neonMagenta],
                      loading: isPurchasing,
                      onPressed: canBuy ? _submit : null,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// Quick-pick bid amounts: the floor, a competitive bid, and a couple of
  /// confident over-bids — all de-duplicated and ordered.
  List<int> _bidPresets() {
    final suggested = _suggestedBid(_lane);
    final set = <int>{
      TopPurchaseSheet.minCoins,
      suggested,
      suggested * 2,
      suggested * 5,
    };
    return set.toList()..sort();
  }

  String _durationLabel(int hours) {
    if (hours % 24 == 0) {
      final d = hours ~/ 24;
      return '$d ${EconomyFormat.plural(d, 'день', 'дня', 'дней')}';
    }
    return '$hours ${EconomyFormat.plural(hours, 'час', 'часа', 'часов')}';
  }
}

/// A larger, two-state choice tile (used for the lane picker).
class _ChoiceTile extends StatelessWidget {
  const _ChoiceTile({
    required this.label,
    required this.selected,
    required this.accent,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final Color accent;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: AppRadii.brMd,
        onTap: onTap,
        child: AnimatedContainer(
          duration: AppDurations.fast,
          height: 48,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: AppRadii.brMd,
            color: selected
                ? accent.withValues(alpha: 0.16)
                : Colors.transparent,
            border: Border.all(
              color: selected
                  ? accent.withValues(alpha: 0.6)
                  : context.colors.glassBorder,
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color: accent,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Text(
                label,
                style: context.texts.labelLarge?.copyWith(
                  color: selected
                      ? context.scheme.onSurface
                      : context.scheme.onSurfaceVariant,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A compact pill-style single choice (used for durations).
class _PillChoice extends StatelessWidget {
  const _PillChoice({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: AppRadii.brPill,
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg,
            vertical: AppSpacing.sm,
          ),
          decoration: BoxDecoration(
            borderRadius: AppRadii.brPill,
            gradient: selected
                ? LinearGradient(colors: colors.ctaGradient)
                : null,
            border: Border.all(
              color: selected ? Colors.transparent : colors.glassBorder,
            ),
          ),
          child: Text(
            label,
            style: context.texts.labelMedium?.copyWith(
              color: selected ? Colors.white : context.scheme.onSurfaceVariant,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            ),
          ),
        ),
      ),
    );
  }
}

/// The current coin balance line within the sheet.
class _BalanceRow extends StatelessWidget {
  const _BalanceRow({required this.balance, required this.insufficient});

  final int? balance;
  final bool insufficient;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.md,
      ),
      decoration: BoxDecoration(
        borderRadius: AppRadii.brMd,
        color: context.scheme.surfaceContainerHighest.withValues(alpha: 0.5),
        border: Border.all(
          color: insufficient
              ? context.scheme.error.withValues(alpha: 0.5)
              : colors.glassBorder,
        ),
      ),
      child: Row(
        children: [
          Icon(
            Icons.account_balance_wallet_outlined,
            size: 18,
            color: context.scheme.onSurfaceVariant,
          ),
          const SizedBox(width: AppSpacing.sm),
          Text(
            'Ваш баланс',
            style: context.texts.bodyMedium?.copyWith(
              color: context.scheme.onSurfaceVariant,
            ),
          ),
          const Spacer(),
          Icon(Icons.monetization_on_rounded, size: 16, color: colors.warning),
          const SizedBox(width: 4),
          Text(
            balance == null ? '—' : EconomyFormat.number(balance!),
            style: context.texts.titleSmall?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}
