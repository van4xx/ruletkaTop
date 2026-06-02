import 'package:flutter/material.dart' hide Badge;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/di.dart';
import '../../../core/models/models.dart';
import '../../../core/router/routes.dart';
import '../../../core/theme/theme.dart';
import '../../../core/widgets/widgets.dart';
import '../../dashboard/presentation/dashboard_providers.dart';
import 'profile_providers.dart';
import 'widgets/gift_showcase_section.dart';
import 'widgets/interests.dart';
import 'widgets/profile_hero.dart';
import 'widgets/profile_section.dart';
import 'widgets/profile_stats_strip.dart';
import 'widgets/send_gift_sheet.dart';

/// `/profile/:id` — a public profile: the shared hero + stats + received-gifts
/// showcase, plus a social/moderation action bar (message · video call · send
/// gift · add friend · report · block) funnelled through
/// [profileActionProvider]. Surfaces action outcomes as snackbars and swaps to
/// a blocked state once the viewer blocks this user.
///
/// Rendered as a pushed sub-page (no bottom nav). When the id resolves to the
/// caller's own account it gently redirects to the own-profile tab.
class PublicProfileScreen extends ConsumerWidget {
  const PublicProfileScreen({super.key, required this.userId});

  final String userId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // If this is the caller's own id, send them to the editable own profile.
    final myId = ref.watch(currentUserIdProvider);
    if (myId != null && myId == userId) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (context.mounted) context.go(AppRoutes.me);
      });
    }

    final profileAsync = ref.watch(profileProvider(userId));
    final action = ref.watch(profileActionProvider(userId));

    // Surface action outcomes (friend request / report / block) as snackbars.
    ref.listen(profileActionProvider(userId), (prev, next) {
      final message = next.message;
      if (message != null && message != prev?.message) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(message)));
        ref.read(profileActionProvider(userId).notifier).consumeMessage();
      }
    });

    return AppScaffold(
      title: 'Профиль',
      showBottomNav: false,
      currentRoute: null,
      body: profileAsync.when(
        loading: () => const _PublicProfileSkeleton(),
        error: (_, _) => ErrorView(
          title: 'Профиль недоступен',
          message: 'Не удалось загрузить профиль. Попробуйте ещё раз.',
          onRetry: () => ref.invalidate(profileProvider(userId)),
        ),
        data: (profile) {
          if (action.blocked) {
            return _BlockedView(nickname: profile.nickname);
          }
          return RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(profileProvider(userId));
              ref.invalidate(giftShowcaseProvider(userId));
              await ref.read(profileProvider(userId).future);
            },
            child: ListView(
              padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg,
                  AppSpacing.lg, AppSpacing.xxxl),
              children: [
                Consumer(
                  builder: (context, ref, _) {
                    final status =
                        ref.watch(presenceProvider)[profile.id];
                    return ProfileHero(profile: profile, status: status);
                  },
                ),
                if (profile.interests.isNotEmpty) ...[
                  const SizedBox(height: AppSpacing.lg),
                  ProfileSection(
                    icon: Icons.interests_rounded,
                    title: 'Интересы',
                    child: InterestChips(interests: profile.interests),
                  ),
                ],
                const SizedBox(height: AppSpacing.lg),
                _PublicStats(userId: userId, profile: profile),
                const SizedBox(height: AppSpacing.lg),
                _PrimaryActions(userId: userId, action: action),
                const SizedBox(height: AppSpacing.lg),
                GiftShowcaseSection(
                  userId: userId,
                  emptyMessage:
                      '${profile.nickname.isEmpty ? 'Пользователь' : profile.nickname} ещё не получал подарков.',
                ),
                const SizedBox(height: AppSpacing.lg),
                _SecondaryActions(userId: userId, action: action),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// The stats strip for a public profile: received-gifts value (from the
/// showcase), profile views, distinct gifts and the registration year.
class _PublicStats extends ConsumerWidget {
  const _PublicStats({required this.userId, required this.profile});

  final String userId;
  final PublicProfile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = context.colors;
    final showcaseAsync = ref.watch(giftShowcaseProvider(userId));
    final showcase = showcaseAsync.value;
    final loading = showcaseAsync.isLoading;

    return ProfileStatsStrip(
      stats: [
        ProfileStat(
          icon: Icons.card_giftcard_rounded,
          value: _format(showcase?.totalValueCoins ?? 0),
          label: 'Подарки',
          accent: colors.neonMagenta,
          loading: loading,
        ),
        ProfileStat(
          icon: Icons.visibility_rounded,
          value: _format(profile.profileViews),
          label: 'Просмотры',
          accent: colors.neonCyan,
        ),
        ProfileStat(
          icon: Icons.auto_awesome_rounded,
          value: '${showcase?.distinctCount ?? 0}',
          label: 'Видов\nподарков',
          accent: colors.neonViolet,
          loading: loading,
        ),
      ],
    );
  }

  static String _format(int v) {
    final s = v.abs().toString();
    final buf = StringBuffer(v < 0 ? '-' : '');
    for (var i = 0; i < s.length; i++) {
      if (i != 0 && (s.length - i) % 3 == 0) buf.write(' ');
      buf.write(s[i]);
    }
    return buf.toString();
  }
}

/// The primary action row: the prominent "Сообщение" + "Подарок" CTAs and a
/// "В друзья" affordance (reflects [ProfileActionState.friendRequested]).
class _PrimaryActions extends ConsumerWidget {
  const _PrimaryActions({required this.userId, required this.action});

  final String userId;
  final ProfileActionState action;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final requested = action.friendRequested;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: GradientButton(
                label: 'Сообщение',
                icon: Icons.chat_bubble_rounded,
                height: 48,
                onPressed: () => context.go(AppRoutes.chats),
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () => SendGiftSheet.show(context, userId).then((sent) {
                  if (sent == true) {
                    ref.invalidate(giftShowcaseProvider(userId));
                  }
                }),
                icon: const Icon(Icons.card_giftcard_rounded, size: 18),
                label: const Text('Подарок'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(48),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.md),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: requested || action.isBusy
                    ? null
                    : () => ref
                        .read(profileActionProvider(userId).notifier)
                        .addFriend(),
                icon: Icon(
                  requested
                      ? Icons.how_to_reg_rounded
                      : Icons.person_add_alt_1_rounded,
                  size: 18,
                ),
                label: Text(requested ? 'Заявка отправлена' : 'В друзья'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(46),
                ),
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () => context.go(AppRoutes.video),
                icon: const Icon(Icons.videocam_rounded, size: 18),
                label: const Text('Видеозвонок'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(46),
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// The moderation row: report + block, styled as low-key destructive actions.
class _SecondaryActions extends ConsumerWidget {
  const _SecondaryActions({required this.userId, required this.action});

  final String userId;
  final ProfileActionState action;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = context.scheme;

    return Row(
      children: [
        Expanded(
          child: TextButton.icon(
            onPressed:
                action.isBusy ? null : () => _openReportSheet(context, ref),
            icon: const Icon(Icons.flag_outlined, size: 18),
            label: const Text('Пожаловаться'),
            style: TextButton.styleFrom(
              foregroundColor: scheme.onSurfaceVariant,
              minimumSize: const Size.fromHeight(44),
            ),
          ),
        ),
        Expanded(
          child: TextButton.icon(
            onPressed:
                action.isBusy ? null : () => _confirmBlock(context, ref),
            icon: const Icon(Icons.block_rounded, size: 18),
            label: const Text('Заблокировать'),
            style: TextButton.styleFrom(
              foregroundColor: scheme.error,
              minimumSize: const Size.fromHeight(44),
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _confirmBlock(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Заблокировать пользователя?'),
        content: const Text(
            'Вы больше не будете получать сообщения и звонки от этого пользователя.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: FilledButton.styleFrom(
                backgroundColor: context.scheme.error),
            child: const Text('Заблокировать'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await ref.read(profileActionProvider(userId).notifier).block();
    }
  }

  Future<void> _openReportSheet(BuildContext context, WidgetRef ref) async {
    final reason = await showModalBottomSheet<ReportReason>(
      context: context,
      backgroundColor: context.scheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius:
            BorderRadius.vertical(top: Radius.circular(AppRadii.xxl)),
      ),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg,
                  AppSpacing.lg, AppSpacing.sm),
              child: Text('Причина жалобы', style: ctx.texts.titleLarge),
            ),
            for (final entry in _reportReasons.entries)
              ListTile(
                leading: Icon(entry.value.$2,
                    color: ctx.scheme.onSurfaceVariant),
                title: Text(entry.value.$1),
                onTap: () => Navigator.of(ctx).pop(entry.key),
              ),
            const SizedBox(height: AppSpacing.sm),
          ],
        ),
      ),
    );
    if (reason != null) {
      await ref.read(profileActionProvider(userId).notifier).report(reason);
    }
  }

  /// Russian labels + glyphs for the report reasons (subset surfaced to users).
  static const Map<ReportReason, (String, IconData)> _reportReasons = {
    ReportReason.harassment: ('Оскорбления и травля', Icons.report_outlined),
    ReportReason.nudity: ('Непристойный контент', Icons.no_adult_content_rounded),
    ReportReason.spam: ('Спам', Icons.block_flipped),
    ReportReason.scam: ('Мошенничество', Icons.gpp_bad_outlined),
    ReportReason.violence: ('Насилие', Icons.dangerous_outlined),
    ReportReason.minor: ('Несовершеннолетний', Icons.child_care_outlined),
    ReportReason.other: ('Другое', Icons.more_horiz_rounded),
  };
}

/// Shown after the viewer blocks this profile.
class _BlockedView extends StatelessWidget {
  const _BlockedView({required this.nickname});

  final String nickname;

  @override
  Widget build(BuildContext context) {
    return EmptyState(
      icon: Icons.block_rounded,
      iconColor: context.scheme.error,
      title: 'Пользователь заблокирован',
      message: nickname.isEmpty
          ? 'Вы больше не будете получать сообщения и звонки от этого пользователя.'
          : '$nickname больше не сможет писать вам или звонить.',
      actionLabel: 'Вернуться',
      onAction: () => context.go(AppRoutes.dashboard),
    );
  }
}

class _PublicProfileSkeleton extends StatelessWidget {
  const _PublicProfileSkeleton();

  @override
  Widget build(BuildContext context) {
    return LoadingShimmer(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.xxxl),
        physics: const NeverScrollableScrollPhysics(),
        children: [
          Container(
            height: 230,
            decoration: BoxDecoration(
              borderRadius: AppRadii.brXl,
              color: context.scheme.surfaceContainerHighest,
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          Container(
            height: 92,
            decoration: BoxDecoration(
              borderRadius: AppRadii.brXl,
              color: context.scheme.surfaceContainerHighest,
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          Container(
            height: 48,
            decoration: BoxDecoration(
              borderRadius: AppRadii.brMd,
              color: context.scheme.surfaceContainerHighest,
            ),
          ),
        ],
      ),
    );
  }
}
