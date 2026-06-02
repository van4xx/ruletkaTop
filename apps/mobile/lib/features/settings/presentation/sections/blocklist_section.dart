import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/api/api.dart';
import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../data/blocklist_controller.dart';
import '../settings_feedback.dart';
import '../widgets/settings_primitives.dart';

/// Blocklist section — users the caller has blocked, each with an unblock
/// action (optimistic). Covers loading / empty / error. The blocks endpoint
/// returns ids + timestamps only, so each row shows a shortened id + the date.
class BlocklistSection extends ConsumerWidget {
  const BlocklistSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final blocksAsync = ref.watch(blocklistControllerProvider);

    return SettingsSection(
      title: 'Чёрный список',
      description: 'Заблокированные не пишут, не звонят и не находят вас.',
      icon: Icons.block_rounded,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
          child: blocksAsync.when(
            loading: () => const Padding(
              padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
              child: Center(child: CircularProgressIndicator(strokeWidth: 2.4)),
            ),
            error: (e, _) => _ErrorRow(
              message: e is ApiException ? e.message : 'Не удалось загрузить.',
              onRetry: () =>
                  ref.read(blocklistControllerProvider.notifier).reload(),
            ),
            data: (blocks) =>
                blocks.isEmpty ? const _EmptyBlocklist() : _List(blocks: blocks),
          ),
        ),
      ],
    );
  }
}

class _List extends ConsumerWidget {
  const _List({required this.blocks});

  final List<Block> blocks;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      children: [
        for (var i = 0; i < blocks.length; i++) ...[
          if (i > 0) const SettingRowDivider(),
          _BlockRow(block: blocks[i]),
        ],
      ],
    );
  }
}

class _BlockRow extends ConsumerStatefulWidget {
  const _BlockRow({required this.block});

  final Block block;

  @override
  ConsumerState<_BlockRow> createState() => _BlockRowState();
}

class _BlockRowState extends ConsumerState<_BlockRow> {
  bool _busy = false;

  Future<void> _unblock() async {
    setState(() => _busy = true);
    try {
      await ref
          .read(blocklistControllerProvider.notifier)
          .unblock(widget.block.blockedUserId);
      if (mounted) showSettingsSaved(context, 'Пользователь разблокирован');
    } on ApiException catch (e) {
      if (mounted) showSettingsError(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;
    final id = widget.block.blockedUserId;
    final shortId = id.length > 10 ? '${id.substring(0, 6)}…${id.substring(id.length - 4)}' : id;
    final date = _formatRuDate(widget.block.createdAt);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
      child: Row(
        children: [
          CircleAvatar(
            radius: 20,
            backgroundColor: scheme.surfaceContainerHighest,
            child: Icon(Icons.block_rounded, size: 18, color: scheme.onSurfaceVariant),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(shortId, style: context.texts.bodyMedium),
                Text(
                  'Заблокирован $date',
                  style: context.texts.bodySmall
                      ?.copyWith(color: scheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          OutlinedButton(
            onPressed: _busy ? null : _unblock,
            child: _busy
                ? const SizedBox(
                    height: 16,
                    width: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Разблокировать'),
          ),
        ],
      ),
    );
  }
}

class _EmptyBlocklist extends StatelessWidget {
  const _EmptyBlocklist();

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
      child: Column(
        children: [
          Icon(Icons.sentiment_satisfied_alt_outlined,
              size: 32, color: scheme.onSurfaceVariant),
          const SizedBox(height: AppSpacing.sm),
          Text('Список пуст', style: context.texts.titleSmall),
          const SizedBox(height: 2),
          Text(
            'Заблокировать собеседника можно во время звонка.',
            textAlign: TextAlign.center,
            style: context.texts.bodySmall
                ?.copyWith(color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

/// Russian "d MMMM yyyy" date without relying on `intl` locale-data init
/// (which `main.dart` may not have called).
String _formatRuDate(DateTime d) {
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  return '${d.day} ${months[d.month - 1]} ${d.year}';
}

class _ErrorRow extends StatelessWidget {
  const _ErrorRow({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
      child: Column(
        children: [
          Text(
            message,
            textAlign: TextAlign.center,
            style: context.texts.bodySmall
                ?.copyWith(color: context.scheme.onSurfaceVariant),
          ),
          const SizedBox(height: AppSpacing.sm),
          OutlinedButton(onPressed: onRetry, child: const Text('Повторить')),
        ],
      ),
    );
  }
}
