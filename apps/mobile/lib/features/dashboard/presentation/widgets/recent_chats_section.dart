import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/di/di.dart';
import '../../../../core/models/models.dart';
import '../../../../core/router/routes.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../dashboard_providers.dart';
import 'dash_section_header.dart';

/// A preview of the most-recently-active conversations (capped), each row
/// showing the peer's avatar, nickname, last-message preview, relative time and
/// an unread badge. Taps through to the chat thread. Mirrors the web recent-
/// chats widget.
class RecentChatsSection extends ConsumerWidget {
  const RecentChatsSection({super.key, this.limit = 4});

  final int limit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final chatsAsync = ref.watch(recentChatsProvider);
    final unread = ref.watch(unreadTotalProvider);

    return GlassCard(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          DashWidgetHeader(
            icon: Icons.chat_bubble_rounded,
            title: 'Сообщения',
            accent: context.colors.neonMagenta,
            count: unread,
            linkRoute: AppRoutes.chats,
          ),
          const SizedBox(height: AppSpacing.xs),
          chatsAsync.when(
            loading: () => LoadingShimmer.list(
                items: 3, padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm)),
            error: (_, _) => Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
              child: Text(
                'Не удалось загрузить чаты.',
                style: context.texts.bodySmall
                    ?.copyWith(color: context.scheme.onSurfaceVariant),
              ),
            ),
            data: (chats) {
              if (chats.isEmpty) return const _EmptyChats();
              final preview = chats.take(limit).toList(growable: false);
              return Column(
                children: [
                  for (var i = 0; i < preview.length; i++) ...[
                    if (i > 0)
                      Divider(
                        height: 1,
                        thickness: 1,
                        color: context.colors.glassBorder.withValues(alpha: 0.5),
                      ),
                    _ChatRow(conversation: preview[i]),
                  ],
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class _ChatRow extends ConsumerWidget {
  const _ChatRow({required this.conversation});

  final Conversation conversation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selfId = ref.watch(currentUserIdProvider);
    final peerId = selfId != null ? conversation.peerId(selfId) : null;
    final peerAsync =
        peerId != null ? ref.watch(profileByIdProvider(peerId)) : null;
    final peer = peerAsync?.value;

    final hasUnread = conversation.unreadCount > 0;

    return InkWell(
      borderRadius: AppRadii.brLg,
      onTap: () => context.go(AppRoutes.chatTo(conversation.id)),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
        child: Row(
          children: [
            NeonAvatar(
              imageUrl: peer?.avatarUrl,
              name: peer?.nickname,
              size: 44,
              ring: peer?.isPremium ?? false,
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          peer?.nickname ?? 'Собеседник',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: context.texts.titleSmall?.copyWith(
                            fontWeight:
                                hasUnread ? FontWeight.w700 : FontWeight.w600,
                          ),
                        ),
                      ),
                      if (conversation.lastMessageAt != null)
                        Text(
                          _relativeTime(conversation.lastMessageAt!),
                          style: context.texts.labelSmall?.copyWith(
                              color: context.scheme.onSurfaceVariant),
                        ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          conversation.lastMessagePreview ?? 'Нет сообщений',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: context.texts.bodySmall?.copyWith(
                            color: hasUnread
                                ? context.scheme.onSurface
                                : context.scheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                      if (hasUnread) ...[
                        const SizedBox(width: AppSpacing.sm),
                        Container(
                          constraints: const BoxConstraints(minWidth: 20),
                          height: 20,
                          alignment: Alignment.center,
                          padding: const EdgeInsets.symmetric(horizontal: 6),
                          decoration: BoxDecoration(
                            borderRadius: AppRadii.brPill,
                            color: context.colors.neonMagenta,
                          ),
                          child: Text(
                            conversation.unreadCount > 99
                                ? '99+'
                                : '${conversation.unreadCount}',
                            style: context.texts.labelSmall?.copyWith(
                                color: Colors.white, fontWeight: FontWeight.w700),
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  static const List<String> _months = [
    'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
    'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
  ];

  /// Compact relative time (e.g. "5м", "2ч", "вчера", or "3 мар"). Locale-free
  /// so it needs no `intl` date-format initialization.
  static String _relativeTime(DateTime time) {
    final now = DateTime.now();
    final diff = now.difference(time);
    if (diff.inMinutes < 1) return 'сейчас';
    if (diff.inMinutes < 60) return '${diff.inMinutes}м';
    if (diff.inHours < 24) return '${diff.inHours}ч';
    if (diff.inDays == 1) return 'вчера';
    if (diff.inDays < 7) return '${diff.inDays}д';
    return '${time.day} ${_months[time.month - 1]}';
  }
}

class _EmptyChats extends StatelessWidget {
  const _EmptyChats();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
      alignment: Alignment.center,
      child: Column(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              borderRadius: AppRadii.brLg,
              color: context.scheme.surfaceContainerHighest,
            ),
            child: Icon(Icons.chat_bubble_outline_rounded,
                size: 22, color: context.scheme.onSurfaceVariant),
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Пока нет переписок',
            style: context.texts.bodySmall
                ?.copyWith(color: context.scheme.onSurfaceVariant),
          ),
          const SizedBox(height: AppSpacing.xs),
          TextButton.icon(
            onPressed: () => context.go(AppRoutes.video),
            icon: Icon(Icons.videocam_rounded,
                size: 16, color: context.colors.neonViolet),
            label: const Text('Начать общение'),
          ),
        ],
      ),
    );
  }
}
