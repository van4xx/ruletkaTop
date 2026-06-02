import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../models/models.dart';
import '../theme/theme.dart';

/// A circular avatar with the brand's neon ring + optional presence dot.
///
/// - Loads [imageUrl] via `cached_network_image`; falls back to colorful
///   initials derived from [name] when the URL is null/empty or fails.
/// - [ring] draws the violet→cyan→magenta gradient halo (used to highlight
///   premium / active users); [status] adds a presence dot bottom-right.
class NeonAvatar extends StatelessWidget {
  const NeonAvatar({
    super.key,
    required this.imageUrl,
    this.name,
    this.size = 48,
    this.ring = true,
    this.status,
    this.glow = false,
  });

  final String? imageUrl;
  final String? name;
  final double size;

  /// Draw the gradient ring around the avatar.
  final bool ring;

  /// When set, renders a presence dot (online/away/in-call/offline).
  final OnlineStatus? status;

  /// Add a soft neon glow behind the avatar (e.g. for premium peers).
  final bool glow;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final ringWidth = ring ? (size * 0.06).clamp(2.0, 4.0) : 0.0;
    final inner = size - ringWidth * 2;

    Widget avatar = ClipOval(
      child: SizedBox(
        width: inner,
        height: inner,
        child: (imageUrl != null && imageUrl!.isNotEmpty)
            ? CachedNetworkImage(
                imageUrl: imageUrl!,
                fit: BoxFit.cover,
                placeholder: (_, _) => _Fallback(name: name, size: inner),
                errorWidget: (_, _, _) => _Fallback(name: name, size: inner),
              )
            : _Fallback(name: name, size: inner),
      ),
    );

    if (ring) {
      avatar = Container(
        width: size,
        height: size,
        padding: EdgeInsets.all(ringWidth),
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: SweepGradient(colors: [...colors.brandGradient, colors.neonViolet]),
          boxShadow: glow ? AppShadows.glow(colors.neonViolet, strength: 0.6) : null,
        ),
        child: avatar,
      );
    } else {
      avatar = SizedBox(width: size, height: size, child: avatar);
    }

    if (status == null) return avatar;

    final dotSize = (size * 0.28).clamp(10.0, 16.0);
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        children: [
          avatar,
          Positioned(
            right: 0,
            bottom: 0,
            child: Container(
              width: dotSize,
              height: dotSize,
              decoration: BoxDecoration(
                color: _statusColor(context, status!),
                shape: BoxShape.circle,
                border: Border.all(color: context.scheme.surface, width: 2),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Color _statusColor(BuildContext context, OnlineStatus status) => switch (status) {
        OnlineStatus.online => context.colors.success,
        OnlineStatus.inCall => context.colors.neonMagenta,
        OnlineStatus.away => context.colors.warning,
        OnlineStatus.offline => context.scheme.onSurfaceVariant,
      };
}

/// Initials-on-gradient fallback when there is no avatar image.
class _Fallback extends StatelessWidget {
  const _Fallback({required this.name, required this.size});

  final String? name;
  final double size;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final initials = _initials(name);
    // Pick a deterministic gradient pair from the name so avatars feel varied.
    final seed = (name?.codeUnits.fold<int>(0, (a, b) => a + b) ?? 0);
    final pair = [
      [colors.neonViolet, colors.neonMagenta],
      [colors.neonCyan, colors.neonViolet],
      [colors.neonMagenta, colors.neonCyan],
    ][seed % 3];

    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: pair,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Center(
        child: Text(
          initials,
          style: AppTypography.display(
            fontSize: size * 0.38,
            color: Colors.white,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }

  static String _initials(String? name) {
    final n = name?.trim() ?? '';
    if (n.isEmpty) return '?';
    final parts = n.split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.length == 1) {
      return parts.first.characters.take(2).toString().toUpperCase();
    }
    return (parts.first.characters.take(1).toString() +
            parts[1].characters.take(1).toString())
        .toUpperCase();
  }
}
