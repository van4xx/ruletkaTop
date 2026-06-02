import 'package:flutter/material.dart';

import '../theme/theme.dart';

/// A self-contained shimmer skeleton (no external dependency). Wrap any
/// placeholder layout built from [ShimmerBox]es in a [LoadingShimmer] to give
/// it the sweeping highlight while data loads.
///
/// Honors `MediaQuery.disableAnimations` (reduced-motion) by holding still.
class LoadingShimmer extends StatefulWidget {
  const LoadingShimmer({super.key, required this.child});

  final Widget child;

  /// A ready-made vertical list of placeholder rows (avatar + two lines).
  static Widget list({int items = 6, EdgeInsetsGeometry? padding}) {
    return LoadingShimmer(
      child: ListView.separated(
        padding: padding ?? AppSpacing.page,
        itemCount: items,
        physics: const NeverScrollableScrollPhysics(),
        separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.md),
        itemBuilder: (_, _) => const _RowSkeleton(),
      ),
    );
  }

  @override
  State<LoadingShimmer> createState() => _LoadingShimmerState();
}

class _LoadingShimmerState extends State<LoadingShimmer>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    final base = context.scheme.surfaceContainerHighest;
    final highlight = Color.alphaBlend(
      context.scheme.onSurface.withValues(alpha: 0.06),
      base,
    );

    if (reduceMotion) {
      return ShaderMask(
        shaderCallback: (bounds) => LinearGradient(colors: [base, base]).createShader(bounds),
        child: widget.child,
      );
    }

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final dx = (_controller.value * 2) - 1; // -1 → 1
        return ShaderMask(
          blendMode: BlendMode.srcATop,
          shaderCallback: (bounds) {
            return LinearGradient(
              begin: Alignment(dx - 0.6, 0),
              end: Alignment(dx + 0.6, 0),
              colors: [base, highlight, base],
              stops: const [0.35, 0.5, 0.65],
            ).createShader(bounds);
          },
          child: child,
        );
      },
      child: widget.child,
    );
  }
}

/// A single rounded placeholder block. Compose these into skeleton layouts.
class ShimmerBox extends StatelessWidget {
  const ShimmerBox({
    super.key,
    this.width,
    this.height = 14,
    this.borderRadius = AppRadii.brSm,
    this.shape = BoxShape.rectangle,
  });

  final double? width;
  final double height;
  final BorderRadius borderRadius;
  final BoxShape shape;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: shape == BoxShape.circle ? height : width,
      height: height,
      decoration: BoxDecoration(
        color: context.scheme.surfaceContainerHighest,
        shape: shape,
        borderRadius: shape == BoxShape.circle ? null : borderRadius,
      ),
    );
  }
}

class _RowSkeleton extends StatelessWidget {
  const _RowSkeleton();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const ShimmerBox(height: 48, shape: BoxShape.circle),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: const [
              ShimmerBox(width: 140, height: 14),
              SizedBox(height: AppSpacing.sm),
              ShimmerBox(width: 90, height: 12),
            ],
          ),
        ),
      ],
    );
  }
}
