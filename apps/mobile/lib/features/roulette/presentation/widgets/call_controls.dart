import 'package:flutter/material.dart';

import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../../domain/roulette_state.dart';

/// The floating call control bar shared by /video and /voice — the Dart port of
/// the web `CallControls`.
///
///  - Primary action: a single Start → Next button (the product's core loop).
///  - Media toggles: mic always (+ camera, camera-flip in video mode).
///  - Social actions: gift, add friend, chat, plus a "more" menu (report/block).
///  - Stop ends the session entirely.
class CallControls extends StatelessWidget {
  const CallControls({
    super.key,
    required this.status,
    required this.isVideo,
    required this.micMuted,
    required this.cameraOff,
    required this.isStarting,
    required this.hasPeer,
    required this.chatOpen,
    required this.onStart,
    required this.onNext,
    required this.onStop,
    required this.onToggleMic,
    required this.onToggleCamera,
    required this.onSwitchCamera,
    required this.onGift,
    required this.onAddFriend,
    required this.onToggleChat,
    required this.onReport,
    required this.onBlock,
  });

  final RouletteStatus status;
  final bool isVideo;
  final bool micMuted;
  final bool cameraOff;
  final bool isStarting;
  final bool hasPeer;
  final bool chatOpen;
  final VoidCallback onStart;
  final VoidCallback onNext;
  final VoidCallback onStop;
  final VoidCallback onToggleMic;
  final VoidCallback onToggleCamera;
  final VoidCallback onSwitchCamera;
  final VoidCallback onGift;
  final VoidCallback onAddFriend;
  final VoidCallback onToggleChat;
  final VoidCallback onReport;
  final VoidCallback onBlock;

  bool get _idle => status == RouletteStatus.idle || status == RouletteStatus.error;

  @override
  Widget build(BuildContext context) {
    final active = !_idle; // searching / connecting / connected / ended

    return GlassCard(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: AppSpacing.sm),
      borderRadius: AppRadii.brPill,
      blurSigma: 24,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (active) ...[
            _CircleControl(
              icon: micMuted ? Icons.mic_off_rounded : Icons.mic_rounded,
              label: micMuted ? 'Включить микрофон' : 'Выключить микрофон',
              danger: micMuted,
              onTap: onToggleMic,
            ),
            if (isVideo) ...[
              const SizedBox(width: AppSpacing.sm),
              _CircleControl(
                icon: cameraOff ? Icons.videocam_off_rounded : Icons.videocam_rounded,
                label: cameraOff ? 'Включить камеру' : 'Выключить камеру',
                danger: cameraOff,
                onTap: onToggleCamera,
              ),
              const SizedBox(width: AppSpacing.sm),
              _CircleControl(
                icon: Icons.cameraswitch_rounded,
                label: 'Сменить камеру',
                onTap: onSwitchCamera,
              ),
            ],
            const SizedBox(width: AppSpacing.sm),
          ],

          // Primary action: Start (idle) → Next (active).
          _PrimaryButton(
            label: _idle ? 'Начать' : 'Дальше',
            icon: _idle ? Icons.play_arrow_rounded : Icons.skip_next_rounded,
            loading: isStarting,
            onTap: _idle ? onStart : onNext,
          ),

          if (active) ...[
            const SizedBox(width: AppSpacing.sm),
            _CircleControl(
              icon: Icons.card_giftcard_rounded,
              label: 'Подарок',
              enabled: hasPeer,
              onTap: onGift,
            ),
            const SizedBox(width: AppSpacing.sm),
            _CircleControl(
              icon: Icons.person_add_alt_1_rounded,
              label: 'В друзья',
              enabled: hasPeer,
              onTap: onAddFriend,
            ),
            const SizedBox(width: AppSpacing.sm),
            _CircleControl(
              icon: Icons.chat_bubble_rounded,
              label: 'Чат',
              active: chatOpen,
              enabled: hasPeer,
              onTap: onToggleChat,
            ),
            const SizedBox(width: AppSpacing.sm),
            _MoreMenu(
              enabled: hasPeer,
              onReport: onReport,
              onBlock: onBlock,
            ),
            const SizedBox(width: AppSpacing.sm),
            _CircleControl(
              icon: Icons.call_end_rounded,
              label: 'Завершить',
              danger: true,
              filledDanger: true,
              onTap: onStop,
            ),
          ],
        ],
      ),
    );
  }
}

class _PrimaryButton extends StatelessWidget {
  const _PrimaryButton({
    required this.label,
    required this.icon,
    required this.loading,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool loading;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: AppRadii.brPill,
        boxShadow: AppShadows.glow(colors.neonMagenta, strength: 0.6),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: loading ? null : onTap,
          borderRadius: AppRadii.brPill,
          child: Ink(
            decoration: BoxDecoration(
              gradient: LinearGradient(colors: colors.ctaGradient),
              borderRadius: AppRadii.brPill,
            ),
            child: Container(
              height: 52,
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
              alignment: Alignment.center,
              child: loading
                  ? const SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.4,
                        valueColor: AlwaysStoppedAnimation(Colors.white),
                      ),
                    )
                  : Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(icon, size: 22, color: Colors.white),
                        const SizedBox(width: 6),
                        Text(
                          label,
                          style: context.texts.labelLarge
                              ?.copyWith(color: Colors.white, fontWeight: FontWeight.w800),
                        ),
                      ],
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CircleControl extends StatelessWidget {
  const _CircleControl({
    required this.icon,
    required this.label,
    required this.onTap,
    this.active = false,
    this.danger = false,
    this.filledDanger = false,
    this.enabled = true,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool active;
  final bool danger;
  final bool filledDanger;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;

    final Color bg;
    final Color fg;
    if (!enabled) {
      bg = scheme.surfaceContainerHighest.withValues(alpha: 0.25);
      fg = scheme.onSurfaceVariant.withValues(alpha: 0.4);
    } else if (filledDanger) {
      bg = scheme.error;
      fg = Colors.white;
    } else if (danger) {
      bg = scheme.error.withValues(alpha: 0.18);
      fg = scheme.error;
    } else if (active) {
      bg = colors.neonViolet.withValues(alpha: 0.22);
      fg = colors.neonViolet;
    } else {
      bg = colors.glassFill;
      fg = scheme.onSurface;
    }

    return Tooltip(
      message: label,
      child: Semantics(
        button: true,
        label: label,
        child: Material(
          color: Colors.transparent,
          shape: const CircleBorder(),
          child: InkWell(
            onTap: enabled ? onTap : null,
            customBorder: const CircleBorder(),
            child: Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: bg,
                border: Border.all(color: colors.glassBorder),
              ),
              child: Icon(icon, size: 22, color: fg),
            ),
          ),
        ),
      ),
    );
  }
}

class _MoreMenu extends StatelessWidget {
  const _MoreMenu({required this.enabled, required this.onReport, required this.onBlock});

  final bool enabled;
  final VoidCallback onReport;
  final VoidCallback onBlock;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;
    return PopupMenuButton<String>(
      enabled: enabled,
      tooltip: 'Ещё',
      position: PopupMenuPosition.over,
      onSelected: (v) {
        if (v == 'report') onReport();
        if (v == 'block') onBlock();
      },
      itemBuilder: (context) => [
        PopupMenuItem(
          value: 'report',
          child: Row(
            children: [
              Icon(Icons.flag_rounded, size: 18, color: scheme.onSurface),
              const SizedBox(width: AppSpacing.sm),
              const Text('Пожаловаться'),
            ],
          ),
        ),
        PopupMenuItem(
          value: 'block',
          child: Row(
            children: [
              Icon(Icons.block_rounded, size: 18, color: scheme.error),
              const SizedBox(width: AppSpacing.sm),
              Text('Заблокировать', style: TextStyle(color: scheme.error)),
            ],
          ),
        ),
      ],
      child: Container(
        width: 52,
        height: 52,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: enabled ? colors.glassFill : scheme.surfaceContainerHighest.withValues(alpha: 0.25),
          border: Border.all(color: colors.glassBorder),
        ),
        child: Icon(
          Icons.more_vert_rounded,
          size: 22,
          color: enabled ? scheme.onSurface : scheme.onSurfaceVariant.withValues(alpha: 0.4),
        ),
      ),
    );
  }
}
