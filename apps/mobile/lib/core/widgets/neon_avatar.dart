import 'dart:math' as math;

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../api/api_config.dart';
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
    final scheme = context.scheme;
    final ringWidth = ring ? (size * 0.06).clamp(2.0, 4.0) : 0.0;
    // A hair of dark gap between the ring and the photo reads as a polished
    // "floating" halo rather than a painted border.
    final gap = ring ? (size * 0.02).clamp(1.0, 2.5) : 0.0;
    final inner = size - (ringWidth + gap) * 2;

    // Avatars come back as server-relative paths (`/uploads/avatars/...`), so
    // absolutize them against the API origin before the loader fetches them.
    final resolvedUrl = ApiConfig.resolveMediaUrl(imageUrl);

    Widget avatar = ClipOval(
      child: SizedBox(
        width: inner,
        height: inner,
        child: (resolvedUrl != null && resolvedUrl.isNotEmpty)
            ? CachedNetworkImage(
                imageUrl: resolvedUrl,
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
        padding: EdgeInsets.all(ringWidth + gap),
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          // Tilt the sweep slightly so the seam isn't at 3 o'clock; the extra
          // trailing violet stop closes the loop smoothly.
          gradient: SweepGradient(
            transform: const GradientRotation(-math.pi / 2),
            colors: [
              colors.neonViolet,
              colors.neonCyan,
              colors.neonMagenta,
              colors.neonViolet,
            ],
          ),
          boxShadow: glow ? AppShadows.glow(colors.neonViolet, strength: 0.6) : null,
        ),
        // Carve the gap so the photo sits on the void, not on the gradient.
        child: Container(
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: scheme.surface,
          ),
          padding: EdgeInsets.all(gap),
          child: avatar,
        ),
      );
    } else {
      avatar = SizedBox(width: size, height: size, child: avatar);
    }

    if (status == null) return avatar;

    final statusColor = _statusColor(context, status!);
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
                color: statusColor,
                shape: BoxShape.circle,
                border: Border.all(color: scheme.surface, width: 2),
                boxShadow: status == OnlineStatus.offline
                    ? null
                    : [
                        BoxShadow(
                          color: statusColor.withValues(alpha: 0.6),
                          blurRadius: 6,
                          spreadRadius: -1,
                        ),
                      ],
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
