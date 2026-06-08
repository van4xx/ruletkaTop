import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';

/// Renders a [MediaStream] in an [RTCVideoView], owning the lifecycle of its
/// [RTCVideoRenderer] (initialize on mount, re-attach on stream change, dispose
/// on unmount). Falls back to a glowing avatar placeholder when there is no
/// stream yet, and shows a "camera off" overlay when [cameraOff] is set.
///
/// Mirrors the web `VideoTile`: full-bleed cover fit, optional [mirror] for the
/// local self-view, and a muted local playback (the local tile never echoes).
class VideoTile extends StatefulWidget {
  const VideoTile({
    super.key,
    required this.stream,
    this.mirror = false,
    this.cameraOff = false,
    this.flagged = false,
    this.placeholderName,
    this.placeholderAvatar,
    this.objectFit = RTCVideoViewObjectFit.RTCVideoViewObjectFitCover,
  });

  final MediaStream? stream;
  final bool mirror;
  final bool cameraOff;

  /// On-device screening flagged this (local) feed: blur it heavily and overlay
  /// a "hidden for safety" shield so the offending content is not visible.
  final bool flagged;

  final String? placeholderName;
  final String? placeholderAvatar;
  final RTCVideoViewObjectFit objectFit;

  @override
  State<VideoTile> createState() => _VideoTileState();
}

class _VideoTileState extends State<VideoTile> {
  final RTCVideoRenderer _renderer = RTCVideoRenderer();
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    await _renderer.initialize();
    if (!mounted) return;
    _renderer.srcObject = widget.stream;
    setState(() => _ready = true);
  }

  @override
  void didUpdateWidget(covariant VideoTile oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_ready && !identical(widget.stream, oldWidget.stream)) {
      _renderer.srcObject = widget.stream;
    }
  }

  @override
  void dispose() {
    _renderer.srcObject = null;
    _renderer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final hasVideo = _ready && widget.stream != null && !widget.cameraOff;

    return ColoredBox(
      color: const Color(0xFF07070B),
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (hasVideo)
            RTCVideoView(
              _renderer,
              mirror: widget.mirror,
              objectFit: widget.objectFit,
              filterQuality: FilterQuality.medium,
            )
          else
            _Placeholder(
              name: widget.placeholderName,
              avatarUrl: widget.placeholderAvatar,
              cameraOff: widget.cameraOff,
            ),

          // Screening cut: blanket the tile in a heavy blur + a safety shield so
          // flagged content is never visible (the outbound track is also
          // disabled upstream).
          if (widget.flagged)
            Positioned.fill(
              child: ClipRect(
                child: BackdropFilter(
                  filter: ui.ImageFilter.blur(sigmaX: 24, sigmaY: 24),
                  child: const _FlaggedOverlay(),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// The "hidden for safety" treatment painted over a screening-flagged feed.
class _FlaggedOverlay extends StatelessWidget {
  const _FlaggedOverlay();

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return DecoratedBox(
      decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.55)),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.shield_rounded, size: 30, color: colors.neonMagenta),
            const SizedBox(height: AppSpacing.sm),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
              child: Text(
                'Видео скрыто',
                textAlign: TextAlign.center,
                style: context.texts.labelMedium?.copyWith(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A slowly-breathing neon halo behind the placeholder avatar, so a connecting
/// peer tile feels alive rather than frozen.
class _BreathingHalo extends StatefulWidget {
  const _BreathingHalo({
    required this.size,
    required this.color,
    required this.child,
  });

  final double size;
  final Color color;
  final Widget child;

  @override
  State<_BreathingHalo> createState() => _BreathingHaloState();
}

class _BreathingHaloState extends State<_BreathingHalo>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2400),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, child) {
        final pulse = 0.5 + 0.5 * _c.value;
        return Stack(
          alignment: Alignment.center,
          children: [
            Container(
              width: widget.size * 1.5,
              height: widget.size * 1.5,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                boxShadow: AppShadows.glow(
                  widget.color,
                  strength: 0.5 + pulse * 0.8,
                ),
              ),
            ),
            child!,
          ],
        );
      },
      child: widget.child,
    );
  }
}

class _Placeholder extends StatelessWidget {
  const _Placeholder({this.name, this.avatarUrl, this.cameraOff = false});

  final String? name;
  final String? avatarUrl;
  final bool cameraOff;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    // Camera-off reads as a calm magenta state; an awaited peer pulses violet.
    final haloColor = cameraOff ? colors.neonMagenta : colors.neonViolet;
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _BreathingHalo(
            size: 92,
            color: haloColor,
            child: NeonAvatar(
              imageUrl: avatarUrl,
              name: name,
              size: 92,
              glow: false,
            ),
          ),
          if (cameraOff) ...[
            const SizedBox(height: AppSpacing.lg),
            GlassCard(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.md,
                vertical: AppSpacing.sm,
              ),
              borderRadius: AppRadii.brPill,
              blurSigma: AppBlur.subtle,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.videocam_off_rounded,
                    size: 16,
                    color: colors.neonMagenta,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    'Камера выключена',
                    style: context.texts.labelMedium?.copyWith(
                      color: context.scheme.onSurface,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
