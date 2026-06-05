import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/theme.dart';

/// The shared header for the dashboard's secondary glass widgets (online
/// friends, recent chats, Top feed): a tinted neon glyph chip, a display-cased
/// title, an optional count badge, and a "see all" link with a nudging arrow.
/// Ports the web's `WidgetHeader` so every section reads as one family.
class DashWidgetHeader extends StatelessWidget {
  const DashWidgetHeader({
    super.key,
    required this.icon,
    required this.title,
    this.accent,
    this.count,
    this.linkRoute,
    this.linkLabel = 'Все',
  });

  final IconData icon;
  final String title;

  /// Accent tint for the glyph chip (defaults to neon violet).
  final Color? accent;

  /// A small magenta count chip after the title (e.g. unread). Hidden when null
  /// or non-positive.
  final int? count;

  /// When set, renders a trailing "see all" link routing here.
  final String? linkRoute;
  final String linkLabel;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final tint = accent ?? colors.neonViolet;
    final c = count ?? 0;

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Row(
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              borderRadius: AppRadii.brMd,
              color: tint.withValues(alpha: 0.14),
              border: Border.all(color: tint.withValues(alpha: 0.28)),
            ),
            child: Icon(icon, size: 17, color: tint),
          ),
          const SizedBox(width: AppSpacing.sm),
          Flexible(
            child: Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: context.texts.titleMedium,
            ),
          ),
          if (c > 0) ...[
            const SizedBox(width: AppSpacing.sm),
            Container(
              constraints: const BoxConstraints(minWidth: 20),
              height: 20,
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: 6),
              decoration: BoxDecoration(
                borderRadius: AppRadii.brPill,
                color: colors.neonMagenta.withValues(alpha: 0.18),
                border:
                    Border.all(color: colors.neonMagenta.withValues(alpha: 0.35)),
              ),
              child: Text(
                c > 99 ? '99+' : '$c',
                style: context.texts.labelSmall?.copyWith(
                    color: colors.neonMagenta, fontWeight: FontWeight.w800),
              ),
            ),
          ],
          const Spacer(),
          if (linkRoute != null)
            _SeeAllLink(label: linkLabel, route: linkRoute!),
        ],
      ),
    );
  }
}

class _SeeAllLink extends StatelessWidget {
  const _SeeAllLink({required this.label, required this.route});

  final String label;
  final String route;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => context.go(route),
      borderRadius: AppRadii.brPill,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              label,
              style: context.texts.labelMedium
                  ?.copyWith(color: context.scheme.onSurfaceVariant),
            ),
            const SizedBox(width: 2),
            Icon(Icons.arrow_outward_rounded,
                size: 14, color: context.scheme.onSurfaceVariant),
          ],
        ),
      ),
    );
  }
}
