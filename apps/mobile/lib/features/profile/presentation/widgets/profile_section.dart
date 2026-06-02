import 'package:flutter/material.dart';

import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';

/// A titled glass section used on the profile screens (e.g. "Интересы"). A small
/// neon-tinted icon, an uppercase title, an optional trailing action, and a
/// caller-supplied body. Keeps the interests block visually consistent across
/// the own- and public-profile screens.
class ProfileSection extends StatelessWidget {
  const ProfileSection({
    super.key,
    required this.icon,
    required this.title,
    required this.child,
    this.accent,
    this.trailing,
  });

  final IconData icon;
  final String title;
  final Widget child;
  final Color? accent;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final tint = accent ?? colors.neonMagenta;

    return GlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 30,
                height: 30,
                decoration: BoxDecoration(
                  borderRadius: AppRadii.brSm,
                  color: tint.withValues(alpha: 0.14),
                ),
                child: Icon(icon, size: 17, color: tint),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  title.toUpperCase(),
                  style: context.texts.labelMedium?.copyWith(
                    color: context.scheme.onSurfaceVariant,
                    letterSpacing: 0.6,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              ?trailing,
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          child,
        ],
      ),
    );
  }
}
