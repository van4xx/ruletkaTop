// Hide Flutter's Badge widget so the contract `Badge` enum stays unambiguous.
import 'package:flutter/material.dart' hide Badge;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/api/api.dart';
import '../../../core/models/models.dart';
import '../../../core/router/routes.dart';
import '../../../core/theme/theme.dart';
import '../../../core/widgets/widgets.dart';
import '../domain/friend_requests_controller.dart';

/// `/friends/requests` — the friend-request inbox, wired to the real
/// `GET /friends/requests` endpoint (`{ incoming, outgoing }`).
///
/// * Incoming — people who asked you. Accept (`POST /friends/:id/accept`) or
///   decline (`DELETE /friends/:id`), keyed by `friendshipId`.
/// * Outgoing — requests you sent that are still pending; cancel them
///   (`DELETE /friends/:id`).
/// Both lists show the counterpart's neon avatar + nickname and one-tap actions.
/// A pull-to-refresh re-fetches; live `friend_request` notifications refresh the
/// inbox automatically (see [FriendRequestsController]).
class FriendRequestsScreen extends ConsumerStatefulWidget {
  const FriendRequestsScreen({super.key});

  @override
  ConsumerState<FriendRequestsScreen> createState() => _FriendRequestsScreenState();
}

class _FriendRequestsScreenState extends ConsumerState<FriendRequestsScreen> {
  /// The friendship id currently being mutated, so only its row spins.
  String? _busyId;

  Future<void> _accept(FriendRequestItem item) async {
    setState(() => _busyId = item.friendshipId);
    try {
      await ref.read(friendRequestsControllerProvider.notifier).accept(item.friendshipId);
      _snack('${item.profile.nickname} теперь у вас в друзьях');
    } on ApiException catch (e) {
      _snack(e.message);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _decline(FriendRequestItem item) async {
    setState(() => _busyId = item.friendshipId);
    try {
      await ref.read(friendRequestsControllerProvider.notifier).decline(item.friendshipId);
      _snack('Заявка отклонена');
    } on ApiException catch (e) {
      _snack(e.message);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _cancel(FriendRequestItem item) async {
    setState(() => _busyId = item.friendshipId);
    try {
      await ref.read(friendRequestsControllerProvider.notifier).cancel(item.friendshipId);
      _snack('Заявка отменена');
    } on ApiException catch (e) {
      _snack(e.message);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final requestsAsync = ref.watch(friendRequestsControllerProvider);

    return AppScaffold(
      title: 'Заявки в друзья',
      showBottomNav: false,
      currentRoute: null,
      body: RefreshIndicator(
        onRefresh: () => ref.read(friendRequestsControllerProvider.notifier).refresh(),
        child: requestsAsync.when(
          loading: () => LoadingShimmer.list(items: 5, padding: const EdgeInsets.all(AppSpacing.lg)),
          error: (err, _) => _ErrorList(
            message: err is ApiException ? err.message : 'Не удалось загрузить заявки',
            onRetry: () => ref.read(friendRequestsControllerProvider.notifier).refresh(),
          ),
          data: (data) => _RequestsBody(
            incoming: data.incoming,
            outgoing: data.outgoing,
            busyId: _busyId,
            onAccept: _accept,
            onDecline: _decline,
            onCancel: _cancel,
          ),
        ),
      ),
    );
  }
}

/// The loaded body: an incoming section (accept/decline) followed by an
/// outgoing section (pending/cancel). When both are empty it shows a single
/// friendly empty state that nudges toward discovering people.
class _RequestsBody extends StatelessWidget {
  const _RequestsBody({
    required this.incoming,
    required this.outgoing,
    required this.busyId,
    required this.onAccept,
    required this.onDecline,
    required this.onCancel,
  });

  final List<FriendRequestItem> incoming;
  final List<FriendRequestItem> outgoing;
  final String? busyId;
  final void Function(FriendRequestItem) onAccept;
  final void Function(FriendRequestItem) onDecline;
  final void Function(FriendRequestItem) onCancel;

  @override
  Widget build(BuildContext context) {
    if (incoming.isEmpty && outgoing.isEmpty) {
      // Keep it scrollable so pull-to-refresh still works.
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          SizedBox(height: MediaQuery.sizeOf(context).height * 0.08),
          EmptyState(
            icon: Icons.mark_email_unread_outlined,
            title: 'Нет заявок',
            message:
                'Когда кто-то захочет добавить вас в друзья — или вы отправите заявку — она появится здесь.',
            actionLabel: 'Найти людей',
            onAction: () => context.go(AppRoutes.search),
          ),
        ],
      );
    }

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.xxxl),
      children: [
        // ── Incoming ──
        if (incoming.isNotEmpty) ...[
          SectionHeader(
            title: 'Входящие',
            trailing: _CountChip(count: incoming.length),
          ),
          const SizedBox(height: AppSpacing.xs),
          for (var i = 0; i < incoming.length; i++) ...[
            if (i > 0) const SizedBox(height: AppSpacing.sm),
            _RequestTile(
              item: incoming[i],
              busy: busyId == incoming[i].friendshipId,
              onOpenProfile: () =>
                  context.go(AppRoutes.profileOf(incoming[i].profile.id)),
              primary: _IncomingActions(
                busy: busyId == incoming[i].friendshipId,
                onAccept: () => onAccept(incoming[i]),
                onDecline: () => onDecline(incoming[i]),
              ),
            ),
          ],
          const SizedBox(height: AppSpacing.xl),
        ],

        // ── Outgoing ──
        if (outgoing.isNotEmpty) ...[
          SectionHeader(
            title: 'Исходящие',
            trailing: _CountChip(count: outgoing.length, muted: true),
          ),
          const SizedBox(height: AppSpacing.xs),
          for (var i = 0; i < outgoing.length; i++) ...[
            if (i > 0) const SizedBox(height: AppSpacing.sm),
            _RequestTile(
              item: outgoing[i],
              busy: busyId == outgoing[i].friendshipId,
              onOpenProfile: () =>
                  context.go(AppRoutes.profileOf(outgoing[i].profile.id)),
              primary: _OutgoingActions(
                busy: busyId == outgoing[i].friendshipId,
                onCancel: () => onCancel(outgoing[i]),
              ),
            ),
          ],
        ],
      ],
    );
  }
}

/// A single request row: a neon avatar, nickname (+ first identity badge), a
/// relative timestamp, and a slotted action area (accept/decline or
/// pending/cancel). Tapping the row opens the requester's profile.
class _RequestTile extends StatelessWidget {
  const _RequestTile({
    required this.item,
    required this.busy,
    required this.onOpenProfile,
    required this.primary,
  });

  final FriendRequestItem item;
  final bool busy;
  final VoidCallback onOpenProfile;
  final Widget primary;

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;
    final profile = item.profile;
    final topBadge = profile.badges.isNotEmpty ? profile.badges.first : null;

    return Opacity(
      opacity: busy ? 0.6 : 1,
      child: GlassCard(
        padding: const EdgeInsets.all(AppSpacing.md),
        onTap: onOpenProfile,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                NeonAvatar(
                  imageUrl: profile.avatarUrl,
                  name: profile.nickname,
                  size: 48,
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
                        _relativeTime(item.createdAt),
                        style: context.texts.labelSmall
                            ?.copyWith(color: scheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            primary,
          ],
        ),
      ),
    );
  }
}

/// Accept (primary, gradient) + Decline (outline) for an incoming request.
class _IncomingActions extends StatelessWidget {
  const _IncomingActions({
    required this.busy,
    required this.onAccept,
    required this.onDecline,
  });

  final bool busy;
  final VoidCallback onAccept;
  final VoidCallback onDecline;

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;
    return Row(
      children: [
        Expanded(
          child: GradientButton(
            label: 'Принять',
            icon: Icons.check_rounded,
            height: 42,
            loading: busy,
            onPressed: busy ? null : onAccept,
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: OutlinedButton.icon(
            onPressed: busy ? null : onDecline,
            icon: const Icon(Icons.close_rounded, size: 18),
            label: const Text('Отклонить'),
            style: OutlinedButton.styleFrom(
              foregroundColor: scheme.onSurfaceVariant,
              side: BorderSide(color: context.colors.glassBorder),
            ),
          ),
        ),
      ],
    );
  }
}

/// A "pending" chip + a Cancel button for an outgoing request.
class _OutgoingActions extends StatelessWidget {
  const _OutgoingActions({required this.busy, required this.onCancel});

  final bool busy;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;
    return Row(
      children: [
        Container(
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.sm, vertical: 6),
          decoration: BoxDecoration(
            color: scheme.surfaceContainerHighest.withValues(alpha: 0.4),
            borderRadius: AppRadii.brPill,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.schedule_rounded,
                  size: 14, color: scheme.onSurfaceVariant),
              const SizedBox(width: 4),
              Text(
                'Ожидает',
                style: context.texts.labelSmall
                    ?.copyWith(color: scheme.onSurfaceVariant),
              ),
            ],
          ),
        ),
        const Spacer(),
        if (busy)
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: AppSpacing.md),
            child: SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          )
        else
          OutlinedButton.icon(
            onPressed: onCancel,
            icon: const Icon(Icons.close_rounded, size: 18),
            label: const Text('Отменить'),
            style: OutlinedButton.styleFrom(
              foregroundColor: scheme.onSurfaceVariant,
              side: BorderSide(color: context.colors.glassBorder),
            ),
          ),
      ],
    );
  }
}

/// A small pill showing a section count next to the header.
class _CountChip extends StatelessWidget {
  const _CountChip({required this.count, this.muted = false});

  final int count;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final accent = muted ? context.scheme.onSurfaceVariant : colors.neonViolet;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 2),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: muted ? 0.12 : 0.14),
        borderRadius: AppRadii.brPill,
        border: Border.all(color: accent.withValues(alpha: 0.35)),
      ),
      child: Text(
        '$count',
        style: context.texts.labelMedium?.copyWith(
          color: accent,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

/// Scrollable error state that preserves pull-to-refresh.
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

/// A compact Russian relative-time label ("только что", "5 мин", "3 ч",
/// "2 дн") without depending on `intl` locale data.
String _relativeTime(DateTime time) {
  final diff = DateTime.now().difference(time);
  if (diff.inMinutes < 1) return 'только что';
  if (diff.inMinutes < 60) return '${diff.inMinutes} мин';
  if (diff.inHours < 24) return '${diff.inHours} ч';
  return '${diff.inDays} дн';
}
