import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/di.dart';
import '../../../core/models/models.dart';
import '../../../core/theme/theme.dart';
import '../../../core/widgets/widgets.dart';
import '../data/chat_repository.dart';
import '../domain/chat_thread_controller.dart';
import '../domain/conversations_controller.dart';
import 'package:ruletka/features/chat/lib/relative_time.dart';

/// A single 1:1 message thread (mirrors the web chat thread). Renders the merged
/// chronological history + live/optimistic bubbles from [ChatThreadController],
/// with a composer wired to its `send`/`notifyTyping` API. The header shows the
/// peer's avatar, name and presence; the composer auto-scrolls to the newest
/// message and surfaces the peer's "печатает…" state.
///
/// The controller (a [ChangeNotifier] behind a `Provider.family`) already owns
/// all realtime plumbing — socket send/echo reconciliation, typing, read
/// receipts and pagination — so this screen is a pure view over it.
class ChatThreadScreen extends ConsumerStatefulWidget {
  const ChatThreadScreen({super.key, required this.conversationId});

  final String conversationId;

  @override
  ConsumerState<ChatThreadScreen> createState() => _ChatThreadScreenState();
}

class _ChatThreadScreenState extends ConsumerState<ChatThreadScreen> {
  final ScrollController _scrollController = ScrollController();
  final TextEditingController _composerController = TextEditingController();
  final FocusNode _composerFocus = FocusNode();

  late final ThreadArg _arg = ThreadArg.conversation(widget.conversationId);

  int _lastMessageCount = 0;
  bool _canSend = false;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    _composerController.addListener(_onComposerChanged);
    // Suppress unread inflation on the inbox badge while this thread is open.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref
          .read(conversationsControllerProvider.notifier)
          .setActiveConversation(widget.conversationId);
    });
  }

  @override
  void dispose() {
    // Clear the active-thread marker so live unread inflation resumes.
    ref
        .read(conversationsControllerProvider.notifier)
        .setActiveConversation(null);
    _scrollController
      ..removeListener(_onScroll)
      ..dispose();
    _composerController
      ..removeListener(_onComposerChanged)
      ..dispose();
    _composerFocus.dispose();
    super.dispose();
  }

  void _onComposerChanged() {
    final canSend = _composerController.text.trim().isNotEmpty;
    if (canSend != _canSend) setState(() => _canSend = canSend);
    if (canSend) {
      ref.read(chatThreadControllerProvider(_arg)).notifyTyping();
    }
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    // Bubbles render bottom-anchored (reverse: true), so the *top* of the
    // visible list is the far scroll extent — load older history there.
    final position = _scrollController.position;
    if (position.pixels >= position.maxScrollExtent - 240) {
      ref.read(chatThreadControllerProvider(_arg)).loadOlder();
    }
  }

  void _handleSend() {
    final text = _composerController.text;
    if (text.trim().isEmpty) return;
    ref.read(chatThreadControllerProvider(_arg)).send(text);
    _composerController.clear();
    _scrollToBottom();
    _composerFocus.requestFocus();
  }

  /// Jump to the newest message (offset 0 because the list is reversed).
  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        0,
        duration: AppDurations.normal,
        curve: Curves.easeOut,
      );
    });
  }

  void _maybeAutoScroll(int messageCount) {
    if (messageCount > _lastMessageCount && _scrollController.hasClients) {
      // A new message arrived — keep the freshest bubble in view if the user
      // is already near the bottom (offset≈0 in the reversed list).
      if (_scrollController.position.pixels < 320) _scrollToBottom();
    }
    _lastMessageCount = messageCount;
  }

  @override
  Widget build(BuildContext context) {
    final controller = ref.watch(chatThreadControllerProvider(_arg));
    final selfId = ref.watch(currentUserIdProvider);
    final peer = _peerProfile(ref, selfId);

    return AppScaffold(
      showBottomNav: false,
      currentRoute: null,
      title: null,
      leading: const BackButton(),
      bottom: const PreferredSize(
        preferredSize: Size.fromHeight(1),
        child: _HairlineDivider(),
      ),
      body: Column(
        children: [
          _ThreadHeaderBar(peer: peer),
          Expanded(
            child: ListenableBuilder(
              listenable: controller,
              builder: (context, _) {
                _maybeAutoScroll(controller.messages.length);
                return _ThreadBody(
                  controller: controller,
                  selfId: selfId,
                  scrollController: _scrollController,
                );
              },
            ),
          ),
          _Composer(
            controller: _composerController,
            focusNode: _composerFocus,
            canSend: _canSend,
            onSend: _handleSend,
          ),
        ],
      ),
    );
  }

  /// Resolve the peer's public profile for the header by locating this
  /// conversation in the live inbox, deriving the other participant, and
  /// watching that user's cached profile.
  PublicProfile? _peerProfile(WidgetRef ref, String? selfId) {
    final inbox = ref.watch(conversationsControllerProvider).value;
    if (inbox == null || selfId == null) return null;
    Conversation? conversation;
    for (final c in inbox.conversations) {
      if (c.id == widget.conversationId) {
        conversation = c;
        break;
      }
    }
    final peerId = conversation?.peerId(selfId);
    if (peerId == null) return null;
    return ref.watch(peerProfileProvider(peerId)).value;
  }
}

/// The peer identity strip pinned under the app bar: avatar (+ presence dot),
/// nickname and a presence/typing subtitle.
class _ThreadHeaderBar extends StatelessWidget {
  const _ThreadHeaderBar({required this.peer});

  final PublicProfile? peer;

  @override
  Widget build(BuildContext context) {
    final status =
        peer != null ? OnlineStatus.fromWire(peer!.status) : OnlineStatus.offline;
    final name =
        peer?.nickname.isNotEmpty == true ? peer!.nickname : 'Собеседник';

    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, AppSpacing.md),
      child: Row(
        children: [
          NeonAvatar(
            imageUrl: peer?.avatarUrl,
            name: peer?.nickname,
            size: 42,
            ring: peer?.isPremium ?? false,
            status: peer != null ? status : null,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: context.texts.titleMedium,
                ),
                Text(
                  _presenceLabel(status),
                  style: context.texts.labelSmall?.copyWith(
                    color: status == OnlineStatus.online
                        ? context.colors.success
                        : context.scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  static String _presenceLabel(OnlineStatus status) => switch (status) {
        OnlineStatus.online => 'в сети',
        OnlineStatus.away => 'отошёл',
        OnlineStatus.inCall => 'в звонке',
        OnlineStatus.offline => 'не в сети',
      };
}

/// The scrollable message region: handles the controller's loading / error /
/// empty states and otherwise renders the day-grouped bubble list (+ a typing
/// indicator and an older-page spinner).
class _ThreadBody extends StatelessWidget {
  const _ThreadBody({
    required this.controller,
    required this.selfId,
    required this.scrollController,
  });

  final ChatThreadController controller;
  final String? selfId;
  final ScrollController scrollController;

  @override
  Widget build(BuildContext context) {
    if (controller.isLoading) {
      return LoadingShimmer.list(items: 6);
    }
    if (controller.hasError) {
      return ErrorView(
        message: 'Не удалось загрузить сообщения.',
        onRetry: controller.reload,
      );
    }

    final messages = controller.messages;
    if (messages.isEmpty && !controller.peerTyping) {
      return const EmptyState(
        icon: Icons.waving_hand_outlined,
        title: 'Начните разговор',
        message: 'Отправьте первое сообщение — оно появится здесь.',
      );
    }

    // Build a flat, reversed (newest-first) render list of typed rows so a
    // single ListView can host bubbles, day separators and the typing chip.
    final rows = _buildRows(messages);

    return ListView.builder(
      controller: scrollController,
      reverse: true,
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.lg),
      itemCount: rows.length + (controller.isLoadingOlder ? 1 : 0),
      itemBuilder: (context, index) {
        if (index >= rows.length) {
          return const Padding(
            padding: EdgeInsets.symmetric(vertical: AppSpacing.md),
            child: Center(
              child: SizedBox(
                height: 18,
                width: 18,
                child: CircularProgressIndicator(strokeWidth: 2.2),
              ),
            ),
          );
        }
        return rows[index].build(context);
      },
    );
  }

  /// Compose the newest-first row list: an optional typing chip, then each
  /// message bubble, inserting a day-separator before the first message of
  /// each calendar day.
  List<_ThreadRow> _buildRows(List<ChatMessage> messages) {
    final rows = <_ThreadRow>[];
    if (controller.peerTyping) rows.add(const _TypingRow());

    // Walk chronological order to decide separators + grouping, collecting
    // bottom-to-top so we can reverse into newest-first at the end.
    final chronological = <_ThreadRow>[];
    for (var i = 0; i < messages.length; i++) {
      final m = messages[i];
      final mine = selfId != null && m.senderId == selfId;
      final prev = i > 0 ? messages[i - 1] : null;
      final newDay = prev == null || dayKey(prev.createdAt) != dayKey(m.createdAt);
      // Group consecutive bubbles from the same sender within the same day
      // (tighter spacing, tail only on the last of a run).
      final next = i < messages.length - 1 ? messages[i + 1] : null;
      final sameAsPrev = prev != null &&
          prev.senderId == m.senderId &&
          !newDay;
      final endsRun = next == null ||
          next.senderId != m.senderId ||
          dayKey(next.createdAt) != dayKey(m.createdAt);

      if (newDay) {
        chronological.add(_DaySeparatorRow(m.createdAt));
      }
      chronological.add(_BubbleRow(
        message: m,
        mine: mine,
        grouped: sameAsPrev,
        showTail: endsRun,
        onRetry: m.failed ? () => controller.retry(m) : null,
      ));
    }

    rows.addAll(chronological.reversed);
    return rows;
  }
}

/// A renderable row in the reversed thread list.
abstract class _ThreadRow {
  const _ThreadRow();
  Widget build(BuildContext context);
}

/// A centered "Сегодня / Вчера / 12 мая" day chip.
class _DaySeparatorRow extends _ThreadRow {
  const _DaySeparatorRow(this.when);

  final DateTime when;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md, vertical: 5),
          decoration: BoxDecoration(
            color: context.colors.glassFill,
            borderRadius: AppRadii.brPill,
            border: Border.all(color: context.colors.glassBorder),
          ),
          child: Text(
            formatDayLabel(when),
            style: context.texts.labelSmall
                ?.copyWith(color: context.scheme.onSurfaceVariant),
          ),
        ),
      ),
    );
  }
}

/// A single message bubble (mine = gradient, theirs = glass), with time, a
/// pending/failed/read affordance and an optional retry on failure.
class _BubbleRow extends _ThreadRow {
  const _BubbleRow({
    required this.message,
    required this.mine,
    required this.grouped,
    required this.showTail,
    this.onRetry,
  });

  final ChatMessage message;
  final bool mine;
  final bool grouped;
  final bool showTail;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final radius = Radius.circular(AppRadii.xl);
    final tail = const Radius.circular(5);
    final bubbleRadius = BorderRadius.only(
      topLeft: radius,
      topRight: radius,
      bottomLeft: mine ? radius : (showTail ? tail : radius),
      bottomRight: mine ? (showTail ? tail : radius) : radius,
    );

    final textColor =
        mine ? Colors.white : context.scheme.onSurface;

    Widget bubble = Container(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md, vertical: AppSpacing.sm + 1),
      decoration: BoxDecoration(
        borderRadius: bubbleRadius,
        gradient: mine
            ? LinearGradient(
                colors: colors.ctaGradient,
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              )
            : null,
        color: mine ? null : colors.glassFill,
        border: mine ? null : Border.all(color: colors.glassBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            message.content,
            style: context.texts.bodyMedium?.copyWith(color: textColor),
          ),
          const SizedBox(height: 3),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                formatClock(message.createdAt),
                style: context.texts.labelSmall?.copyWith(
                  fontSize: 10,
                  color: mine
                      ? Colors.white.withValues(alpha: 0.8)
                      : context.scheme.onSurfaceVariant,
                ),
              ),
              if (mine) ...[
                const SizedBox(width: 4),
                _StatusGlyph(message: message),
              ],
            ],
          ),
        ],
      ),
    );

    if (onRetry != null) {
      bubble = Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          bubble,
          const SizedBox(height: 2),
          GestureDetector(
            onTap: onRetry,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.refresh_rounded,
                    size: 13, color: context.scheme.error),
                const SizedBox(width: 3),
                Text(
                  'Не отправлено · повторить',
                  style: context.texts.labelSmall
                      ?.copyWith(color: context.scheme.error),
                ),
              ],
            ),
          ),
        ],
      );
    }

    return Padding(
      padding: EdgeInsets.only(top: grouped ? 2 : AppSpacing.sm),
      child: Opacity(
        opacity: message.pending ? 0.7 : 1,
        child: Row(
          mainAxisAlignment:
              mine ? MainAxisAlignment.end : MainAxisAlignment.start,
          children: [
            ConstrainedBox(
              constraints: BoxConstraints(
                maxWidth: MediaQuery.sizeOf(context).width * 0.76,
              ),
              child: bubble,
            ),
          ],
        ),
      ),
    );
  }
}

/// The delivery glyph on an outgoing bubble: pending → clock, read → double
/// check (cyan), delivered → single check.
class _StatusGlyph extends StatelessWidget {
  const _StatusGlyph({required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final tint = Colors.white.withValues(alpha: 0.85);
    if (message.failed) {
      return Icon(Icons.error_outline_rounded,
          size: 13, color: context.scheme.error);
    }
    if (message.pending) {
      return Icon(Icons.schedule_rounded, size: 12, color: tint);
    }
    if (message.readAt != null) {
      return Icon(Icons.done_all_rounded,
          size: 14, color: context.colors.neonCyan);
    }
    return Icon(Icons.done_rounded, size: 13, color: tint);
  }
}

/// A small "печатает…" chip shown at the bottom of the thread while the peer
/// is typing.
class _TypingRow extends _ThreadRow {
  const _TypingRow();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.sm),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.md, vertical: AppSpacing.sm),
            decoration: BoxDecoration(
              color: context.colors.glassFill,
              borderRadius: AppRadii.brXl,
              border: Border.all(color: context.colors.glassBorder),
            ),
            child: Text(
              'печатает…',
              style: context.texts.bodySmall?.copyWith(
                color: context.scheme.onSurfaceVariant,
                fontStyle: FontStyle.italic,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The message composer pinned to the bottom: a rounded multiline field + a
/// gradient send button (disabled until there's trimmed text).
class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.focusNode,
    required this.canSend,
    required this.onSend,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final bool canSend;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.sm,
        AppSpacing.lg,
        AppSpacing.sm + MediaQuery.viewPaddingOf(context).bottom,
      ),
      decoration: BoxDecoration(
        color: context.scheme.surface,
        border: Border(top: BorderSide(color: colors.glassBorder)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Container(
              decoration: BoxDecoration(
                color: colors.glassFill,
                borderRadius: AppRadii.brXl,
                border: Border.all(color: colors.glassBorder),
              ),
              child: TextField(
                controller: controller,
                focusNode: focusNode,
                minLines: 1,
                maxLines: 5,
                textInputAction: TextInputAction.newline,
                keyboardType: TextInputType.multiline,
                style: context.texts.bodyMedium,
                decoration: InputDecoration(
                  hintText: 'Сообщение…',
                  hintStyle: context.texts.bodyMedium
                      ?.copyWith(color: context.scheme.onSurfaceVariant),
                  border: InputBorder.none,
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.md, vertical: AppSpacing.md),
                ),
              ),
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          _SendButton(enabled: canSend, onTap: onSend),
        ],
      ),
    );
  }
}

/// The circular gradient send affordance.
class _SendButton extends StatelessWidget {
  const _SendButton({required this.enabled, required this.onTap});

  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Opacity(
      opacity: enabled ? 1 : 0.5,
      child: DecoratedBox(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: LinearGradient(
            colors: colors.ctaGradient,
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          boxShadow: enabled
              ? AppShadows.glow(colors.neonMagenta, strength: 0.5)
              : null,
        ),
        child: Material(
          color: Colors.transparent,
          shape: const CircleBorder(),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: enabled ? onTap : null,
            child: const SizedBox(
              width: 48,
              height: 48,
              child: Icon(Icons.send_rounded, color: Colors.white, size: 21),
            ),
          ),
        ),
      ),
    );
  }
}

/// A hairline under the app bar separating chrome from the header strip.
class _HairlineDivider extends StatelessWidget {
  const _HairlineDivider();

  @override
  Widget build(BuildContext context) {
    return Container(height: 1, color: context.colors.glassBorder);
  }
}
