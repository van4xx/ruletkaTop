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
    this.placeholderName,
    this.placeholderAvatar,
    this.objectFit = RTCVideoViewObjectFit.RTCVideoViewObjectFitCover,
  });

  final MediaStream? stream;
  final bool mirror;
  final bool cameraOff;
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
        ],
      ),
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
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          NeonAvatar(imageUrl: avatarUrl, name: name, size: 92, glow: true),
          if (cameraOff) ...[
            const SizedBox(height: AppSpacing.md),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.videocam_off_rounded, size: 16, color: colors.neonMagenta),
                const SizedBox(width: 6),
                Text(
                  'Камера выключена',
                  style: context.texts.bodySmall?.copyWith(color: context.scheme.onSurfaceVariant),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
