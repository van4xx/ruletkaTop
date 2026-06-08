import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../../core/api/api.dart';
import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../data/sessions_provider.dart';
import '../settings_feedback.dart';
import '../widgets/settings_primitives.dart';

/// Active sessions subsection — the caller's logged-in devices, backed by
/// `GET /auth/sessions`. Each session shows its IP / user-agent + last-active
/// time; the current device is flagged and protected. The user can revoke one
/// session or "выйти на других устройствах" (revoke all others).
class SessionsSection extends ConsumerStatefulWidget {
  const SessionsSection({super.key});

  @override
  ConsumerState<SessionsSection> createState() => _SessionsSectionState();
}

class _SessionsSectionState extends ConsumerState<SessionsSection> {
  String? _revokingId;
  bool _revokingOthers = false;

  Future<void> _revoke(AuthSession session) async {
    setState(() => _revokingId = session.id);
    try {
      await ref.read(sessionsControllerProvider.notifier).revoke(session.id);
      if (mounted) showSettingsSaved(context, 'Сеанс завершён');
    } on ApiException catch (e) {
      if (mounted) showSettingsError(context, e.message);
    } catch (_) {
      if (mounted) showSettingsError(context, 'Не удалось завершить сеанс.');
    } finally {
      if (mounted) setState(() => _revokingId = null);
    }
  }

  Future<void> _revokeOthers() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Выйти на других устройствах?'),
        content: const Text(
          'Все сеансы, кроме текущего, будут завершены. Это полезно, если вы '
          'забыли выйти на чужом устройстве.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Выйти везде'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _revokingOthers = true);
    try {
      await ref.read(sessionsControllerProvider.notifier).revokeOthers();
      if (mounted) showSettingsSaved(context, 'Другие сеансы завершены');
    } on ApiException catch (e) {
      if (mounted) showSettingsError(context, e.message);
    } catch (_) {
      if (mounted) showSettingsError(context, 'Не удалось завершить сеансы.');
    } finally {
      if (mounted) setState(() => _revokingOthers = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sessionsAsync = ref.watch(sessionsControllerProvider);
    final sessions = sessionsAsync.value ?? const <AuthSession>[];
    final hasOthers = sessions.any((s) => !s.current);

    return SettingsSection(
      title: 'Активные сессии',
      description: 'Устройства, на которых выполнен вход.',
      icon: Icons.devices_other_rounded,
      footer: hasOthers
          ? Align(
              alignment: Alignment.centerLeft,
              child: OutlinedButton.icon(
                onPressed: _revokingOthers ? null : _revokeOthers,
                icon: _revokingOthers
                    ? const SizedBox(
                        height: 16,
                        width: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.logout_rounded, size: 18),
                label: const Text('Выйти на других устройствах'),
              ),
            )
          : null,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
          child: sessionsAsync.when(
            loading: () => const _SessionsLoading(),
            error: (err, _) => _SessionsError(
              message: err is ApiException
                  ? err.message
                  : 'Не удалось загрузить сеансы.',
              onRetry: () =>
                  ref.read(sessionsControllerProvider.notifier).refresh(),
            ),
            data: (data) => _SessionsList(
              sessions: data,
              revokingId: _revokingId,
              onRevoke: _revoke,
            ),
          ),
        ),
      ],
    );
  }
}

class _SessionsList extends StatelessWidget {
  const _SessionsList({
    required this.sessions,
    required this.revokingId,
    required this.onRevoke,
  });

  final List<AuthSession> sessions;
  final String? revokingId;
  final ValueChanged<AuthSession> onRevoke;

  @override
  Widget build(BuildContext context) {
    if (sessions.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
        child: Text(
          'Активных сеансов не найдено.',
          textAlign: TextAlign.center,
          style: context.texts.bodySmall
              ?.copyWith(color: context.scheme.onSurfaceVariant),
        ),
      );
    }

    // Current device first, then most-recently-active.
    final ordered = [...sessions]..sort((a, b) {
        if (a.current != b.current) return a.current ? -1 : 1;
        final ad = a.lastActiveAt?.millisecondsSinceEpoch ?? 0;
        final bd = b.lastActiveAt?.millisecondsSinceEpoch ?? 0;
        return bd.compareTo(ad);
      });

    return Column(
      children: [
        for (var i = 0; i < ordered.length; i++) ...[
          if (i > 0) const SettingRowDivider(),
          _SessionTile(
            session: ordered[i],
            revoking: revokingId == ordered[i].id,
            onRevoke: () => onRevoke(ordered[i]),
          ),
        ],
      ],
    );
  }
}

class _SessionTile extends StatelessWidget {
  const _SessionTile({
    required this.session,
    required this.revoking,
    required this.onRevoke,
  });

  final AuthSession session;
  final bool revoking;
  final VoidCallback onRevoke;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;
    final title = session.device?.trim().isNotEmpty == true
        ? session.device!.trim()
        : _shortUserAgent(session.userAgent);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            session.current
                ? Icons.verified_user_rounded
                : Icons.devices_rounded,
            size: 20,
            color: session.current ? colors.success : scheme.onSurfaceVariant,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        title,
                        overflow: TextOverflow.ellipsis,
                        style: context.texts.titleSmall,
                      ),
                    ),
                    if (session.current) ...[
                      const SizedBox(width: AppSpacing.sm),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.sm, vertical: 2),
                        decoration: BoxDecoration(
                          borderRadius: AppRadii.brPill,
                          color: colors.success.withValues(alpha: 0.14),
                        ),
                        child: Text(
                          'Это устройство',
                          style: context.texts.labelSmall
                              ?.copyWith(color: colors.success),
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  _subtitle(session),
                  style: context.texts.bodySmall
                      ?.copyWith(color: scheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          if (!session.current) ...[
            const SizedBox(width: AppSpacing.sm),
            revoking
                ? const Padding(
                    padding: EdgeInsets.all(8),
                    child: SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : IconButton(
                    onPressed: onRevoke,
                    tooltip: 'Завершить сеанс',
                    icon: Icon(Icons.logout_rounded,
                        size: 18, color: scheme.error),
                  ),
          ],
        ],
      ),
    );
  }

  /// `<ip> · активность <relative>` (skips missing parts gracefully).
  static String _subtitle(AuthSession session) {
    final parts = <String>[];
    if (session.ip != null && session.ip!.isNotEmpty) parts.add(session.ip!);
    final last = session.lastActiveAt;
    if (last != null) parts.add('активность ${_relative(last)}');
    return parts.isEmpty ? 'Нет данных об устройстве' : parts.join(' · ');
  }

  /// Compact relative time ("только что", "5 мин назад", "3 ч назад", else a
  /// short date) — a lightweight Russian formatter (no plural lib needed).
  static String _relative(DateTime when) {
    final diff = DateTime.now().difference(when);
    if (diff.inMinutes < 1) return 'только что';
    if (diff.inMinutes < 60) return '${diff.inMinutes} мин назад';
    if (diff.inHours < 24) return '${diff.inHours} ч назад';
    if (diff.inDays < 7) return '${diff.inDays} дн назад';
    return DateFormat('d MMM y', 'ru').format(when.toLocal());
  }

  /// Reduce a raw user-agent to a friendly device/browser label, falling back
  /// to "Неизвестное устройство".
  static String _shortUserAgent(String? ua) {
    final value = ua?.trim() ?? '';
    if (value.isEmpty) return 'Неизвестное устройство';
    final lower = value.toLowerCase();
    final os = switch (true) {
      _ when lower.contains('android') => 'Android',
      _ when lower.contains('iphone') || lower.contains('ios') => 'iPhone',
      _ when lower.contains('ipad') => 'iPad',
      _ when lower.contains('mac os') || lower.contains('macintosh') => 'macOS',
      _ when lower.contains('windows') => 'Windows',
      _ when lower.contains('linux') => 'Linux',
      _ => null,
    };
    final browser = switch (true) {
      _ when lower.contains('ruletka') => 'Приложение',
      _ when lower.contains('edg/') => 'Edge',
      _ when lower.contains('chrome') => 'Chrome',
      _ when lower.contains('firefox') => 'Firefox',
      _ when lower.contains('safari') => 'Safari',
      _ => null,
    };
    if (os != null && browser != null) return '$browser · $os';
    return os ?? browser ?? 'Устройство';
  }
}

class _SessionsLoading extends StatelessWidget {
  const _SessionsLoading();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
      child: Center(child: CircularProgressIndicator(strokeWidth: 2.4)),
    );
  }
}

class _SessionsError extends StatelessWidget {
  const _SessionsError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      child: Column(
        children: [
          Icon(Icons.cloud_off_rounded, size: 32, color: scheme.error),
          const SizedBox(height: AppSpacing.sm),
          Text(
            message,
            textAlign: TextAlign.center,
            style: context.texts.bodySmall
                ?.copyWith(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: AppSpacing.sm),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded, size: 18),
            label: const Text('Повторить'),
          ),
        ],
      ),
    );
  }
}
