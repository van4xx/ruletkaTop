import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/models/models.dart';
import '../../../core/theme/theme.dart';
import '../../../core/widgets/widgets.dart';
import '../domain/notifications_controller.dart';
import 'widgets/notification_tile.dart';

/// `/notifications` — the in-app notifications center.
///
/// A cursor-paginated, realtime-folded list of stored notifications: each row
/// shows a kind glyph, title/body and relative time, with unread rows accented.
/// Tapping marks the item read and follows its deep link when present. The
/// app bar carries a "mark all read" action (enabled only while something is
/// unread). Loading / empty / error use the shared kit.
class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() =>
      _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
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
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 400) {
      ref.read(notificationsControllerProvider.notifier).loadMore();
    }
  }

  void _onTapItem(NotificationItem item) {
    ref.read(notificationsControllerProvider.notifier).markRead(item.id);
    final link = item.link;
    if (link != null && link.isNotEmpty) {
      // Deep links mirror the app's route registry (e.g. /chat/<id>,
      // /profile/<id>); unknown links fall through to the router's errorBuilder.
      context.go(link);
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(notificationsControllerProvider);
    final st = async.value;
    final items = st?.items ?? const <NotificationItem>[];
    final hasUnread = (st?.unread ?? 0) > 0;
    final controller = ref.read(notificationsControllerProvider.notifier);

    return AppScaffold(
      title: 'Уведомления',
      currentRoute: null,
      showBottomNav: false,
      actions: [
        IconButton(
          tooltip: 'Прочитать все',
          onPressed: hasUnread ? controller.markAllRead : null,
          icon: const Icon(Icons.done_all_rounded),
        ),
      ],
      body: RefreshIndicator(
        onRefresh: controller.refresh,
        child: _Body(
          async: async,
          items: items,
          scrollController: _scrollController,
          hasMore: st?.hasMore ?? false,
          onTapItem: _onTapItem,
          onRetry: controller.refresh,
        ),
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({
    required this.async,
    required this.items,
    required this.scrollController,
    required this.hasMore,
    required this.onTapItem,
    required this.onRetry,
  });

  final AsyncValue<NotificationsState> async;
  final List<NotificationItem> items;
  final ScrollController scrollController;
  final bool hasMore;
  final void Function(NotificationItem) onTapItem;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    // First load.
    if (async.isLoading && items.isEmpty) {
      return LoadingShimmer.list(items: 8);
    }
    // Hard error with nothing to show.
    if (async.hasError && items.isEmpty) {
      return _ScrollableFill(
        child: ErrorView(
          title: 'Не удалось загрузить',
          message: 'Уведомления временно недоступны.',
          onRetry: onRetry,
        ),
      );
    }
    if (items.isEmpty) {
      return _ScrollableFill(
        child: const EmptyState(
          icon: Icons.notifications_none_rounded,
          title: 'Пока нет уведомлений',
          message: 'Здесь появятся заявки в друзья, подарки, сообщения и '
              'звонки.',
        ),
      );
    }

    return ListView.separated(
      controller: scrollController,
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.xxxl),
      itemCount: items.length + (hasMore ? 1 : 0),
      separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.sm),
      itemBuilder: (context, i) {
        if (i >= items.length) {
          return const Padding(
            padding: EdgeInsets.all(AppSpacing.lg),
            child: Center(
              child: SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2.4),
              ),
            ),
          );
        }
        final item = items[i];
        return NotificationTile(item: item, onTap: () => onTapItem(item));
      },
    );
  }
}

/// Wraps a centered child so it stays pull-to-refreshable even when short.
class _ScrollableFill extends StatelessWidget {
  const _ScrollableFill({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: constraints.maxHeight),
          child: child,
        ),
      ),
    );
  }
}
