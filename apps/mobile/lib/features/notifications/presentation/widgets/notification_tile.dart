import 'package:flutter/material.dart';

import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../notification_meta.dart';

/// A single notification row: a kind glyph, title + body + relative time, and an
/// unread accent (tinted fill + a neon dot). Tapping marks it read and follows
/// its deep [NotificationItem.link] when present.
class NotificationTile extends StatelessWidget {
  const NotificationTile({super.key, required this.item, this.onTap});

  final NotificationItem item;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final accent = NotificationMeta.accent(context, item.kind);
    final unread = !item.read;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppRadii.brXl,
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: AppRadii.brXl,
            // A faint tinted wash distinguishes unread rows.
            color: unread ? accent.withValues(alpha: 0.07) : Colors.transparent,
            border: Border.all(
              color: unread ? accent.withValues(alpha: 0.28) : colors.glassBorder,
            ),
          ),
          padding: const EdgeInsets.all(AppSpacing.md),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _KindAvatar(kind: item.kind, accent: accent, glow: unread),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            item.title.isEmpty
                                ? NotificationMeta.label(item.kind)
                                : item.title,
                            style: context.texts.titleSmall?.copyWith(
                              fontWeight:
                                  unread ? FontWeight.w700 : FontWeight.w600,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        Text(
                          NotificationMeta.relativeTime(item.createdAt),
                          style: context.texts.labelSmall
                              ?.copyWith(color: context.scheme.onSurfaceVariant),
                        ),
                        if (unread) ...[
                          const SizedBox(width: AppSpacing.sm),
                          Container(
                            width: 8,
                            height: 8,
                            decoration: BoxDecoration(
                              color: accent,
                              shape: BoxShape.circle,
                              boxShadow: AppShadows.glow(accent, strength: 0.5),
                            ),
                          ),
                        ],
                      ],
                    ),
                    if (item.body.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        item.body,
                        style: context.texts.bodySmall
                            ?.copyWith(color: context.scheme.onSurfaceVariant),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ],
                ),
              ),
              if (item.link != null && item.link!.isNotEmpty) ...[
                const SizedBox(width: AppSpacing.xs),
                Icon(Icons.chevron_right_rounded,
                    size: 20, color: context.scheme.onSurfaceVariant),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// The circular, kind-tinted icon leading a notification row.
class _KindAvatar extends StatelessWidget {
  const _KindAvatar({
    required this.kind,
    required this.accent,
    required this.glow,
  });

  final NotificationKind kind;
  final Color accent;
  final bool glow;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 42,
      height: 42,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: accent.withValues(alpha: 0.16),
        boxShadow: glow ? AppShadows.glow(accent, strength: 0.35) : null,
      ),
      child: Icon(NotificationMeta.icon(kind), size: 20, color: accent),
    );
  }
}
