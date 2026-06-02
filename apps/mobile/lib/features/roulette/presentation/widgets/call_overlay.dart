import 'package:flutter/material.dart' hide Badge;

import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../../data/webrtc_service.dart';
import '../../domain/roulette_state.dart';
import 'call_timer.dart';

const Map<Gender, String> _genderLabel = {
  Gender.male: 'М',
  Gender.female: 'Ж',
  Gender.other: '',
};

/// The peer-identity overlay shown during a call: avatar (video only), nickname,
/// age + gender, country flag + name, badges, and a live timer / "connecting"
/// pill. Mirrors the web `CallOverlay`. Rendered top-left over the remote video
/// or above the avatar in voice mode (where [compact] hides the avatar).
class CallOverlay extends StatelessWidget {
  const CallOverlay({
    super.key,
    required this.peer,
    required this.status,
    this.compact = false,
    this.quality = ConnectionQuality.unknown,
    this.reconnecting = false,
  });

  final PeerInfo peer;
  final RouletteStatus status;

  /// Hide the avatar (voice mode shows its own big avatar already).
  final bool compact;

  /// Live connection-quality bucket (drives the signal-bars indicator).
  final ConnectionQuality quality;

  /// The transport dropped and we're recovering — drives the status pill copy.
  final bool reconnecting;

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;
    final connected = status == RouletteStatus.connected;
    final genderSuffix = _genderLabel[peer.gender] ?? '';

    return GlassCard(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
      borderRadius: AppRadii.brXl,
      blurSigma: 12,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (!compact) ...[
            NeonAvatar(
              imageUrl: peer.avatarUrl,
              name: peer.nickname,
              size: 40,
              ring: peer.isPremium,
            ),
            const SizedBox(width: AppSpacing.sm),
          ],
          Flexible(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Flexible(
                      child: Text(
                        peer.nickname,
                        overflow: TextOverflow.ellipsis,
                        style: AppTypography.display(fontSize: 14, color: scheme.onSurface),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      genderSuffix.isEmpty ? '${peer.age}' : '${peer.age}, $genderSuffix',
                      style: context.texts.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    CountryFlag(countryCode: peer.country, size: 13),
                    const SizedBox(width: 4),
                    Text(
                      peer.country,
                      style: context.texts.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                    if (peer.badges.isNotEmpty) ...[
                      const SizedBox(width: AppSpacing.sm),
                      ...peer.badges.take(2).map(
                            (b) => Padding(
                              padding: const EdgeInsets.only(right: 4),
                              child: UserBadgePill(badge: b),
                            ),
                          ),
                    ],
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          // Live signal-strength bars (only once connected with a real sample).
          if (connected && quality != ConnectionQuality.unknown) ...[
            _SignalBars(quality: quality, dimmed: reconnecting),
            const SizedBox(width: AppSpacing.sm),
          ],
          _StatusPill(connected: connected, reconnecting: reconnecting),
        ],
      ),
    );
  }
}

/// A four-bar signal-strength meter (à la mobile reception) coloured by the
/// live [ConnectionQuality]. Filled bars scale with quality; while reconnecting
/// the whole meter dims so the user sees we've lost a solid path.
class _SignalBars extends StatelessWidget {
  const _SignalBars({required this.quality, this.dimmed = false});

  final ConnectionQuality quality;
  final bool dimmed;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;

    // Filled bar count + accent per bucket. (unknown is filtered out upstream.)
    final (filled, color) = switch (quality) {
      ConnectionQuality.excellent => (4, colors.success),
      ConnectionQuality.good => (3, colors.success),
      ConnectionQuality.fair => (2, colors.warning),
      ConnectionQuality.poor => (1, colors.neonMagenta),
      ConnectionQuality.unknown => (0, scheme.onSurfaceVariant),
    };
    final label = switch (quality) {
      ConnectionQuality.excellent => 'Отличное соединение',
      ConnectionQuality.good => 'Хорошее соединение',
      ConnectionQuality.fair => 'Среднее соединение',
      ConnectionQuality.poor => 'Слабое соединение',
      ConnectionQuality.unknown => 'Соединение',
    };
    final accent = dimmed ? color.withValues(alpha: 0.45) : color;
    final empty = scheme.onSurfaceVariant.withValues(alpha: 0.28);

    return Tooltip(
      message: label,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: List.generate(4, (i) {
          final on = i < filled;
          return Padding(
            padding: EdgeInsets.only(left: i == 0 ? 0.0 : 2.5),
            child: Container(
              width: 3.5,
              height: 6.0 + i * 3.5, // 6, 9.5, 13, 16.5
              decoration: BoxDecoration(
                color: on ? accent : empty,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          );
        }),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.connected, this.reconnecting = false});

  final bool connected;
  final bool reconnecting;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    // Reconnecting takes precedence over the connected/timer view: amber pill
    // with a pulsing dot, while keeping the call mounted underneath.
    final color = reconnecting
        ? colors.warning
        : connected
            ? colors.success
            : colors.neonMagenta;
    final showTimer = connected && !reconnecting;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.16),
        borderRadius: AppRadii.brPill,
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          reconnecting
              ? _PulsingDot(color: color)
              : Container(
                  width: 7,
                  height: 7,
                  decoration: BoxDecoration(color: color, shape: BoxShape.circle),
                ),
          const SizedBox(width: 5),
          showTimer
              ? CallTimer(
                  running: true,
                  style: context.texts.labelSmall
                      ?.copyWith(color: color, fontWeight: FontWeight.w700, fontFeatures: const []),
                )
              : Text(
                  reconnecting ? 'Переподключение…' : 'Соединение…',
                  style: context.texts.labelSmall?.copyWith(color: color, fontWeight: FontWeight.w700),
                ),
        ],
      ),
    );
  }
}

/// A softly pulsing status dot used for the "reconnecting" pill.
class _PulsingDot extends StatefulWidget {
  const _PulsingDot({required this.color});

  final Color color;

  @override
  State<_PulsingDot> createState() => _PulsingDotState();
}

class _PulsingDotState extends State<_PulsingDot> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 850),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: Tween<double>(begin: 0.35, end: 1.0).animate(_c),
      child: Container(
        width: 7,
        height: 7,
        decoration: BoxDecoration(color: widget.color, shape: BoxShape.circle),
      ),
    );
  }
}
