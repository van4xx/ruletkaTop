import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/di.dart';
import '../../../core/models/models.dart';
import '../../../core/router/routes.dart';
import '../../../core/theme/theme.dart';
import '../../../core/widgets/widgets.dart';
import '../../notifications/domain/notifications_controller.dart';
import '../data/chat_repository.dart';
import '../domain/conversations_controller.dart';
import 'package:ruletka/features/chat/lib/relative_time.dart';

/// The conversation inbox (mirrors the web `/chats`). A live, pull-to-refresh
/// list of the user's conversations — each row showing the peer's avatar +
/// presence, nickname, last-message preview, relative time and an unread badge.
/// Tapping a row opens the 1:1 thread.
///
/// The list is kept live by [ConversationsController] over the socket (incoming
/// messages re-sort + bump unread, read receipts zero the badge), so this
/// screen only renders state. Older pages load as the user nears the bottom.
class ChatsScreen extends ConsumerStatefulWidget {
  const ChatsScreen({super.key});

  @override
  ConsumerState<ChatsScreen> createState() => _ChatsScreenState();
}

class _ChatsScreenState extends ConsumerState<ChatsScreen> {
  final ScrollController _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController
      ..removeListener(_onScroll)
      ..dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final position = _scrollController.position;
    if (position.pixels >= position.maxScrollExtent - 280) {
      ref.read(conversationsControllerProvider.notifier).loadMore();
    }
  }

  Future<void> _refresh() =>
      ref.read(conversationsControllerProvider.notifier).refresh();

  @override
  Widget build(BuildContext context) {
    final inboxAsync = ref.watch(conversationsControllerProvider);
    final unread = ref.watch(notificationsUnreadProvider);

    return AppScaffold(
      title: 'Чаты',
      currentRoute: AppRoutes.chats,
      actions: [
        NotificationsButton(count: unread),
        const SizedBox(width: AppSpacing.xs),
      ],
      body: inboxAsync.when(
        loading: () => LoadingShimmer.list(
          items: 8,
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg, vertical: AppSpacing.lg),
        ),
        error: (err, _) => ErrorView(
          message: 'Не удалось загрузить переписки.',
          onRetry: _refresh,
        ),
        data: (state) {
          if (state.conversations.isEmpty) {
            return RefreshIndicator(
              onRefresh: _refresh,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  SizedBox(
                    height: MediaQuery.sizeOf(context).height * 0.62,
                    child: EmptyState(
                      icon: Icons.forum_outlined,
                      title: 'Пока нет переписок',
                      message:
                          'Начните общение в рулетке или напишите друзьям — '
                          'диалоги появятся здесь.',
                      actionLabel: 'Начать общение',
                      onAction: () => context.go(AppRoutes.video),
                    ),
                  ),
                ],
              ),
            );
          }

          final conversations = state.conversations;
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView.separated(
              controller: _scrollController,
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.xxxl),
              itemCount: conversations.length + (state.isLoadingMore ? 1 : 0),
              separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.sm),
              itemBuilder: (context, index) {
                if (index >= conversations.length) {
                  return const Padding(
                    padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
                    child: Center(
                      child: SizedBox(
                        height: 22,
                        width: 22,
                        child: CircularProgressIndicator(strokeWidth: 2.4),
                      ),
                    ),
                  );
                }
                return _ConversationTile(conversation: conversations[index]);
              },
            ),
          );
        },
      ),
    );
  }
}

/// A single inbox row inside a [GlassCard]: peer avatar (+ presence dot),
/// nickname, last-message preview, relative time and an unread pill.
class _ConversationTile extends ConsumerWidget {
  const _ConversationTile({required this.conversation});

  final Conversation conversation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selfId = ref.watch(currentUserIdProvider);
    final peerId = selfId != null ? conversation.peerId(selfId) : null;
    final peerAsync =
        peerId != null ? ref.watch(peerProfileProvider(peerId)) : null;
    final peer = peerAsync?.value;

    final hasUnread = conversation.unreadCount > 0;
    final name = peer?.nickname.isNotEmpty == true
        ? peer!.nickname
        : 'Собеседник';
    final preview = conversation.lastMessagePreview?.trim();
    final hasPreview = preview != null && preview.isNotEmpty;

    return GlassCard(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md, vertical: AppSpacing.md),
      onTap: () => context.push(AppRoutes.chatTo(conversation.id)),
      child: Row(
        children: [
          NeonAvatar(
            imageUrl: peer?.avatarUrl,
            name: peer?.nickname,
            size: 52,
            ring: peer?.isPremium ?? false,
            status: peer != null
                ? OnlineStatus.fromWire(peer.status)
                : null,
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
                        name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: context.texts.titleSmall?.copyWith(
                          fontWeight:
                              hasUnread ? FontWeight.w700 : FontWeight.w600,
                        ),
                      ),
                    ),
                    if (conversation.lastMessageAt != null) ...[
                      const SizedBox(width: AppSpacing.sm),
                      Text(
                        formatRelativeTime(conversation.lastMessageAt!),
                        style: context.texts.labelSmall?.copyWith(
                          color: hasUnread
                              ? context.colors.neonMagenta
                              : context.scheme.onSurfaceVariant,
                          fontWeight:
                              hasUnread ? FontWeight.w700 : FontWeight.w600,
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 3),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        hasPreview ? preview : 'Нет сообщений',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: context.texts.bodySmall?.copyWith(
                          color: hasUnread
                              ? context.scheme.onSurface
                              : context.scheme.onSurfaceVariant,
                          fontWeight:
                              hasUnread ? FontWeight.w600 : FontWeight.w400,
                          fontStyle:
                              hasPreview ? FontStyle.normal : FontStyle.italic,
                        ),
                      ),
                    ),
                    if (hasUnread) ...[
                      const SizedBox(width: AppSpacing.sm),
                      _UnreadBadge(count: conversation.unreadCount),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A neon-magenta pill carrying the unread count (caps at 99+).
class _UnreadBadge extends StatelessWidget {
  const _UnreadBadge({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minWidth: 22),
      height: 22,
      alignment: Alignment.center,
      padding: const EdgeInsets.symmetric(horizontal: 7),
      decoration: BoxDecoration(
        borderRadius: AppRadii.brPill,
        color: context.colors.neonMagenta,
        boxShadow: AppShadows.glow(context.colors.neonMagenta, strength: 0.4),
      ),
      child: Text(
        count > 99 ? '99+' : '$count',
        style: context.texts.labelSmall?.copyWith(
          color: Colors.white,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}
