import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/api/api.dart';
import '../../../core/models/models.dart' hide Badge;
import '../../../core/router/routes.dart';
import '../../../core/theme/theme.dart';
import '../../../core/widgets/widgets.dart';
import '../../calls/domain/direct_call_controller.dart';
import '../../chat/domain/conversations_controller.dart';
import '../domain/friend_requests_controller.dart';
import '../domain/friends_controller.dart';
import 'widgets/friend_tile.dart';

/// `/friends` — the caller's friends list with live presence and quick actions
/// to chat or call. Surfaces incoming friend-request awareness via an app-bar
/// action that badges the count and opens `/friends/requests`.
class FriendsScreen extends ConsumerStatefulWidget {
  const FriendsScreen({super.key});

  @override
  ConsumerState<FriendsScreen> createState() => _FriendsScreenState();
}

class _FriendsScreenState extends ConsumerState<FriendsScreen> {
  final _scrollController = ScrollController();

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
    if (position.pixels >= position.maxScrollExtent - 320) {
      ref.read(friendsControllerProvider.notifier).loadMore();
    }
  }

  /// Open (or start) a 1:1 chat with a friend. Reuses an existing conversation
  /// from the loaded inbox when present; otherwise opens a compose thread keyed
  /// by the friend's user id (the first sent message creates the conversation).
  void _openChat(String userId) {
    final existing =
        ref.read(conversationsControllerProvider.notifier).conversationWithPeer(userId);
    if (existing != null) {
      context.push(AppRoutes.chatTo('c:${existing.id}'));
    } else {
      context.push(AppRoutes.chatTo('u:$userId'));
    }
  }

  /// Invite a friend to a video call. Routes through the global direct-call
  /// host so the outgoing ring is tracked (it surfaces a ringing sheet and
  /// reacts to the friend's accept/decline/end over the `call:*` socket events).
  void _call(FriendSummary friend) {
    ref
        .read(directCallControllerProvider.notifier)
        .placeCall(friend.profile.id, MatchType.video);
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(
        SnackBar(content: Text('Звоним ${friend.profile.nickname}…')),
      );
  }

  Future<void> _confirmRemove(FriendSummary friend) async {
    final confirmed = await _confirm(
      title: 'Удалить из друзей?',
      message: '${friend.profile.nickname} будет удалён(а) из ваших друзей.',
      confirmLabel: 'Удалить',
    );
    if (confirmed != true) return;
    try {
      await ref.read(friendsControllerProvider.notifier).remove(friend.friendshipId);
    } on ApiException catch (e) {
      _snack(e.message);
    }
  }

  Future<void> _confirmBlock(FriendSummary friend) async {
    final confirmed = await _confirm(
      title: 'Заблокировать?',
      message:
          '${friend.profile.nickname} больше не сможет писать вам или звонить.',
      confirmLabel: 'Заблокировать',
      destructive: true,
    );
    if (confirmed != true) return;
    try {
      await ref.read(friendsControllerProvider.notifier).block(friend.profile.id);
      _snack('${friend.profile.nickname} заблокирован(а)');
    } on ApiException catch (e) {
      _snack(e.message);
    }
  }

  Future<bool?> _confirm({
    required String title,
    required String message,
    required String confirmLabel,
    bool destructive = false,
  }) {
    return showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Отмена'),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            style: destructive
                ? TextButton.styleFrom(foregroundColor: context.scheme.error)
                : null,
            child: Text(confirmLabel),
          ),
        ],
      ),
    );
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final friendsAsync = ref.watch(friendsControllerProvider);
    final requestCount = ref.watch(friendRequestsCountProvider);

    return AppScaffold(
      title: 'Друзья',
      currentRoute: AppRoutes.friends,
      actions: [
        IconButton(
          tooltip: 'Заявки в друзья',
          onPressed: () => context.push(AppRoutes.friendRequests),
          icon: Badge(
            isLabelVisible: requestCount > 0,
            label: Text(requestCount > 99 ? '99+' : '$requestCount'),
            child: const Icon(Icons.person_add_alt_1_rounded),
          ),
        ),
      ],
      body: RefreshIndicator(
        onRefresh: () => ref.read(friendsControllerProvider.notifier).refresh(),
        child: friendsAsync.when(
          loading: () => LoadingShimmer.list(items: 7),
          error: (err, _) => _ErrorList(
            message: err is ApiException ? err.message : 'Не удалось загрузить друзей',
            onRetry: () => ref.read(friendsControllerProvider.notifier).refresh(),
          ),
          data: (state) => _FriendsList(
            state: state,
            scrollController: _scrollController,
            onMessage: _openChat,
            onCall: _call,
            onRemove: _confirmRemove,
            onBlock: _confirmBlock,
          ),
        ),
      ),
    );
  }
}

class _FriendsList extends StatelessWidget {
  const _FriendsList({
    required this.state,
    required this.scrollController,
    required this.onMessage,
    required this.onCall,
    required this.onRemove,
    required this.onBlock,
  });

  final FriendsState state;
  final ScrollController scrollController;
  final void Function(String userId) onMessage;
  final void Function(FriendSummary friend) onCall;
  final void Function(FriendSummary friend) onRemove;
  final void Function(FriendSummary friend) onBlock;

  @override
  Widget build(BuildContext context) {
    if (state.friends.isEmpty) {
      // Wrap the empty state in a scrollable so pull-to-refresh still works.
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          SizedBox(height: MediaQuery.sizeOf(context).height * 0.12),
          EmptyState(
            icon: Icons.group_add_rounded,
            title: 'Пока нет друзей',
            message:
                'Знакомьтесь в рулетке или найдите людей по нику — и добавляйте их в друзья.',
            actionLabel: 'Найти людей',
            onAction: () => context.push(AppRoutes.search),
          ),
        ],
      );
    }

    final total = state.friends.length;
    final itemCount = total + 2; // header + (rows) + footer

    return ListView.separated(
      controller: scrollController,
      physics: const AlwaysScrollableScrollPhysics(),
      padding: AppSpacing.page,
      itemCount: itemCount,
      separatorBuilder: (context, index) =>
          index == 0 ? const SizedBox.shrink() : const SizedBox(height: AppSpacing.sm),
      itemBuilder: (context, index) {
        if (index == 0) {
          return Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: _FriendsSummaryHeader(
              total: total,
              online: state.onlineCount,
            ),
          );
        }
        if (index == itemCount - 1) {
          if (state.isLoadingMore) {
            return const Padding(
              padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
              child: Center(
                child: SizedBox(
                  width: 24,
                  height: 24,
                  child: CircularProgressIndicator(strokeWidth: 2.4),
                ),
              ),
            );
          }
          return const SizedBox(height: AppSpacing.xl);
        }
        final friend = state.friends[index - 1];
        return FriendTile(
          friend: friend,
          onMessage: () => onMessage(friend.profile.id),
          onCall: () => onCall(friend),
          onOpenProfile: () => context.push(AppRoutes.profileOf(friend.profile.id)),
          onRemove: () => onRemove(friend),
          onBlock: () => onBlock(friend),
        );
      },
    );
  }
}

/// A compact summary card: total friends + how many are online right now.
class _FriendsSummaryHeader extends StatelessWidget {
  const _FriendsSummaryHeader({required this.total, required this.online});

  final int total;
  final int online;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return GlassCard(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.lg, vertical: AppSpacing.md),
      child: Row(
        children: [
          Icon(Icons.people_alt_rounded, color: colors.neonViolet),
          const SizedBox(width: AppSpacing.md),
          Text('$total ${_plural(total)}', style: context.texts.titleMedium),
          const Spacer(),
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: online > 0 ? colors.success : context.scheme.onSurfaceVariant,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Text(
            online > 0 ? '$online в сети' : 'Нет в сети',
            style: context.texts.bodyMedium
                ?.copyWith(color: context.scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }

  /// Russian plural for "друг" (1 друг / 2 друга / 5 друзей).
  static String _plural(int n) {
    final mod10 = n % 10;
    final mod100 = n % 100;
    if (mod10 == 1 && mod100 != 11) return 'друг';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'друга';
    return 'друзей';
  }
}

class _ErrorList extends StatelessWidget {
  const _ErrorList({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        SizedBox(height: MediaQuery.sizeOf(context).height * 0.12),
        ErrorView(message: message, onRetry: onRetry),
      ],
    );
  }
}
