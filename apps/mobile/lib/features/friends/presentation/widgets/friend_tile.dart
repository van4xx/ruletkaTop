// Hide Flutter's Badge widget so the contract `Badge` enum is unambiguous.
import 'package:flutter/material.dart' hide Badge;

import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';

/// A single friend row: neon avatar with a presence dot, nickname (+ the first
/// identity badge), a human status line, and quick chat/call actions plus an
/// overflow menu. Used by the friends list.
class FriendTile extends StatelessWidget {
  const FriendTile({
    super.key,
    required this.friend,
    required this.onMessage,
    required this.onCall,
    required this.onOpenProfile,
    required this.onRemove,
    required this.onBlock,
  });

  final FriendSummary friend;
  final VoidCallback onMessage;
  final VoidCallback onCall;
  final VoidCallback onOpenProfile;
  final VoidCallback onRemove;
  final VoidCallback onBlock;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final profile = friend.profile;
    final topBadge = profile.badges.isNotEmpty ? profile.badges.first : null;

    return GlassCard(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md, vertical: AppSpacing.sm),
      onTap: onOpenProfile,
      child: Row(
        children: [
          NeonAvatar(
            imageUrl: profile.avatarUrl,
            name: profile.nickname,
            size: 52,
            status: friend.status,
            glow: profile.isPremium,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        profile.nickname,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: context.texts.titleMedium,
                      ),
                    ),
                    if (topBadge != null) ...[
                      const SizedBox(width: AppSpacing.sm),
                      UserBadgePill(badge: topBadge),
                    ],
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  _statusLabel(friend.status),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: context.texts.bodySmall?.copyWith(
                    color: friend.status == OnlineStatus.offline
                        ? context.scheme.onSurfaceVariant
                        : _statusColor(context, friend.status),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.xs),
          _RoundAction(
            icon: Icons.chat_bubble_rounded,
            tooltip: 'Написать',
            color: colors.neonCyan,
            onTap: onMessage,
          ),
          const SizedBox(width: AppSpacing.xs),
          _RoundAction(
            icon: Icons.videocam_rounded,
            tooltip: 'Видеозвонок',
            color: colors.neonViolet,
            onTap: onCall,
          ),
          PopupMenuButton<_FriendMenu>(
            icon: const Icon(Icons.more_vert_rounded),
            tooltip: 'Ещё',
            onSelected: (value) => switch (value) {
              _FriendMenu.profile => onOpenProfile(),
              _FriendMenu.remove => onRemove(),
              _FriendMenu.block => onBlock(),
            },
            itemBuilder: (context) => [
              const PopupMenuItem(
                value: _FriendMenu.profile,
                child: ListTile(
                  leading: Icon(Icons.person_outline_rounded),
                  title: Text('Профиль'),
                  contentPadding: EdgeInsets.zero,
                ),
              ),
              const PopupMenuItem(
                value: _FriendMenu.remove,
                child: ListTile(
                  leading: Icon(Icons.person_remove_outlined),
                  title: Text('Удалить из друзей'),
                  contentPadding: EdgeInsets.zero,
                ),
              ),
              PopupMenuItem(
                value: _FriendMenu.block,
                child: ListTile(
                  leading: Icon(Icons.block_rounded, color: context.scheme.error),
                  title: Text('Заблокировать',
                      style: TextStyle(color: context.scheme.error)),
                  contentPadding: EdgeInsets.zero,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  static String _statusLabel(OnlineStatus status) => switch (status) {
        OnlineStatus.online => 'В сети',
        OnlineStatus.inCall => 'В звонке',
        OnlineStatus.away => 'Отошёл',
        OnlineStatus.offline => 'Не в сети',
      };

  static Color _statusColor(BuildContext context, OnlineStatus status) =>
      switch (status) {
        OnlineStatus.online => context.colors.success,
        OnlineStatus.inCall => context.colors.neonMagenta,
        OnlineStatus.away => context.colors.warning,
        OnlineStatus.offline => context.scheme.onSurfaceVariant,
      };
}

enum _FriendMenu { profile, remove, block }

/// A small circular icon button used for the inline quick actions.
class _RoundAction extends StatelessWidget {
  const _RoundAction({
    required this.icon,
    required this.tooltip,
    required this.color,
    required this.onTap,
  });

  final IconData icon;
  final String tooltip;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: color.withValues(alpha: 0.14),
        shape: const CircleBorder(),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(9),
            child: Icon(icon, size: 20, color: color),
          ),
        ),
      ),
    );
  }
}
