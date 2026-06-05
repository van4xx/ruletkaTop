import 'package:flutter/material.dart';

import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../../domain/roulette_state.dart';

/// The floating call control bar shared by /video and /voice — the Dart port of
/// the web `CallControls`.
///
///  - Primary action: a single Start → Next button (the product's core loop),
///    a neon violet→magenta gradient pill with a tactile press-scale + glow.
///  - Media toggles: mic always (+ camera, camera-flip in video mode).
///  - Social actions: gift, add friend, chat, plus a "more" menu (report/block).
///  - Stop ends the session entirely.
///
/// Every round button is a true liquid-glass disc that scales down + blooms a
/// neon press glow when held, so the bar feels alive and native-premium.
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

  bool get _idle =>
      status == RouletteStatus.idle || status == RouletteStatus.error;

  @override
  Widget build(BuildContext context) {
    final active = !_idle; // searching / connecting / connected / ended

    return GlassCard(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: AppSpacing.sm,
      ),
      borderRadius: AppRadii.brPill,
      blurSigma: AppBlur.heavy,
      intensity: 1.1,
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
                icon: cameraOff
                    ? Icons.videocam_off_rounded
                    : Icons.videocam_rounded,
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
              glow: context.colors.neonMagenta,
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
            _MoreMenu(enabled: hasPeer, onReport: onReport, onBlock: onBlock),
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

class _PrimaryButton extends StatefulWidget {
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
  State<_PrimaryButton> createState() => _PrimaryButtonState();
}

class _PrimaryButtonState extends State<_PrimaryButton> {
  bool _pressed = false;

  void _set(bool v) {
    if (_pressed != v) setState(() => _pressed = v);
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return AnimatedScale(
      scale: _pressed && !widget.loading ? 0.96 : 1,
      duration: AppDurations.press,
      curve: AppCurves.glass,
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: AppRadii.brPill,
          boxShadow: AppShadows.glow(
            colors.neonMagenta,
            strength: _pressed ? 1.0 : 0.65,
          ),
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: widget.loading ? null : widget.onTap,
            onHighlightChanged: _set,
            borderRadius: AppRadii.brPill,
            splashColor: Colors.white.withValues(alpha: 0.18),
            highlightColor: Colors.white.withValues(alpha: 0.06),
            child: Ink(
              decoration: BoxDecoration(
                gradient: LinearGradient(colors: colors.ctaGradient),
                borderRadius: AppRadii.brPill,
              ),
              child: Ink(
                // Glassy top sheen over the gradient for depth.
                decoration: BoxDecoration(
                  borderRadius: AppRadii.brPill,
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      Colors.white.withValues(alpha: 0.24),
                      Colors.white.withValues(alpha: 0),
                    ],
                    stops: const [0.0, 0.55],
                  ),
                ),
                child: Container(
                  height: 52,
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.xl,
                  ),
                  alignment: Alignment.center,
                  child: widget.loading
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
                            Icon(widget.icon, size: 22, color: Colors.white),
                            const SizedBox(width: 6),
                            Text(
                              widget.label,
                              style: context.texts.labelLarge?.copyWith(
                                color: Colors.white,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ],
                        ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A round liquid-glass control disc with a tactile press (scale-down + neon
/// bloom). States: default (glass), active (violet tint), danger (red tint),
/// filledDanger (solid red — the hang-up), disabled (dimmed + inert).
class _CircleControl extends StatefulWidget {
  const _CircleControl({
    required this.icon,
    required this.label,
    required this.onTap,
    this.active = false,
    this.danger = false,
    this.filledDanger = false,
    this.enabled = true,
    this.glow,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool active;
  final bool danger;
  final bool filledDanger;
  final bool enabled;

  /// Override the press-glow color (defaults to violet, or red for danger).
  final Color? glow;

  @override
  State<_CircleControl> createState() => _CircleControlState();
}

class _CircleControlState extends State<_CircleControl> {
  bool _pressed = false;

  void _set(bool v) {
    if (!widget.enabled || _pressed == v) return;
    setState(() => _pressed = v);
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;

    final Color bg;
    final Color fg;
    if (!widget.enabled) {
      bg = scheme.surfaceContainerHighest.withValues(alpha: 0.25);
      fg = scheme.onSurfaceVariant.withValues(alpha: 0.4);
    } else if (widget.filledDanger) {
      bg = scheme.error;
      fg = Colors.white;
    } else if (widget.danger) {
      bg = scheme.error.withValues(alpha: 0.18);
      fg = scheme.error;
    } else if (widget.active) {
      bg = colors.neonViolet.withValues(alpha: 0.22);
      fg = colors.neonViolet;
    } else {
      bg = colors.glassFill;
      fg = scheme.onSurface;
    }

    // The press-glow accent: explicit override → red (danger) → violet.
    final glowColor =
        widget.glow ??
        (widget.danger || widget.filledDanger
            ? scheme.error
            : colors.neonViolet);

    return Tooltip(
      message: widget.label,
      child: Semantics(
        button: true,
        label: widget.label,
        child: AnimatedScale(
          scale: _pressed ? 0.9 : 1,
          duration: AppDurations.press,
          curve: AppCurves.glass,
          child: DecoratedBox(
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              boxShadow: [
                if (_pressed && widget.enabled)
                  ...AppShadows.glow(glowColor, strength: 0.9)
                else if (widget.filledDanger)
                  ...AppShadows.glow(scheme.error, strength: 0.4),
              ],
            ),
            child: Material(
              color: Colors.transparent,
              shape: const CircleBorder(),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: widget.enabled ? widget.onTap : null,
                onHighlightChanged: _set,
                customBorder: const CircleBorder(),
                splashColor: glowColor.withValues(alpha: 0.18),
                highlightColor: glowColor.withValues(alpha: 0.10),
                child: Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: bg,
                    border: Border.all(color: colors.glassBorder),
                  ),
                  child: Icon(widget.icon, size: 22, color: fg),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _MoreMenu extends StatelessWidget {
  const _MoreMenu({
    required this.enabled,
    required this.onReport,
    required this.onBlock,
  });

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
      color: scheme.surface.withValues(alpha: 0.96),
      shape: RoundedRectangleBorder(
        borderRadius: AppRadii.brXl,
        side: BorderSide(color: colors.glassBorder),
      ),
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
          color: enabled
              ? colors.glassFill
              : scheme.surfaceContainerHighest.withValues(alpha: 0.25),
          border: Border.all(color: colors.glassBorder),
        ),
        child: Icon(
          Icons.more_vert_rounded,
          size: 22,
          color: enabled
              ? scheme.onSurface
              : scheme.onSurfaceVariant.withValues(alpha: 0.4),
        ),
      ),
    );
  }
}
