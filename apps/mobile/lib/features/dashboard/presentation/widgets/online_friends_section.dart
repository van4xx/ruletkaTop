import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/models/models.dart';
import '../../../../core/router/routes.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../dashboard_providers.dart';
import 'dash_section_header.dart';

/// A horizontally-scrolling strip of friends who are reachable right now
/// (online / away / in-call), each with a live presence dot. Taps through to a
/// friend's profile. Driven by [onlineFriendsProvider] (friends + live socket
/// presence). Mirrors the web online-friends widget.
class OnlineFriendsSection extends ConsumerWidget {
  const OnlineFriendsSection({super.key});

  static const Map<OnlineStatus, String> _statusLabel = {
    OnlineStatus.online: 'В сети',
    OnlineStatus.away: 'Отошёл',
    OnlineStatus.inCall: 'В звонке',
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = context.colors;
    final friendsAsync = ref.watch(friendsProvider);
    final online = ref.watch(onlineFriendsProvider);

    return GlassCard(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          DashWidgetHeader(
            icon: Icons.bolt_rounded,
            title: 'Друзья онлайн',
            accent: colors.neonCyan,
            count: online.length,
            linkRoute: AppRoutes.friends,
          ),
          const SizedBox(height: AppSpacing.sm),
          friendsAsync.when(
            loading: () => _loadingStrip(),
            error: (_, _) => Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
              child: Text(
                'Список временно недоступен.',
                style: context.texts.bodySmall
                    ?.copyWith(color: context.scheme.onSurfaceVariant),
              ),
            ),
            data: (friends) {
              if (online.isEmpty) {
                return _EmptyFriends(hasAny: friends.isNotEmpty);
              }
              return SizedBox(
                height: 92,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: online.length,
                  separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.sm),
                  itemBuilder: (_, i) {
                    final entry = online[i];
                    return _FriendChip(
                      profile: entry.friend.profile,
                      status: entry.status,
                      label: _statusLabel[entry.status] ?? 'В сети',
                    );
                  },
                ),
              );
            },
          ),
          if (online.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.sm),
            Align(
              alignment: Alignment.centerLeft,
              child: Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.sm, vertical: 4),
                decoration: BoxDecoration(
                  borderRadius: AppRadii.brPill,
                  color: colors.neonCyan.withValues(alpha: 0.12),
                  border:
                      Border.all(color: colors.neonCyan.withValues(alpha: 0.28)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(
                          shape: BoxShape.circle, color: colors.neonCyan),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      '${online.length} ${_pluralOnline(online.length)} в сети',
                      style: context.texts.labelSmall?.copyWith(
                          color: colors.neonCyan, fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _loadingStrip() {
    return SizedBox(
      height: 92,
      child: LoadingShimmer(
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: 5,
          separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.sm),
          itemBuilder: (_, _) => const SizedBox(
            width: 64,
            child: Column(
              children: [
                ShimmerBox(height: 56, shape: BoxShape.circle),
                SizedBox(height: AppSpacing.sm),
                ShimmerBox(width: 44, height: 10),
              ],
            ),
          ),
        ),
      ),
    );
  }

  static String _pluralOnline(int n) {
    final mod10 = n % 10;
    final mod100 = n % 100;
    if (mod10 == 1 && mod100 != 11) return 'друг';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'друга';
    return 'друзей';
  }
}

class _FriendChip extends StatelessWidget {
  const _FriendChip({
    required this.profile,
    required this.status,
    required this.label,
  });

  final FriendProfile profile;
  final OnlineStatus status;
  final String label;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 64,
      child: InkWell(
        borderRadius: AppRadii.brLg,
        onTap: () => context.push(AppRoutes.profileOf(profile.id)),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              NeonAvatar(
                imageUrl: profile.avatarUrl,
                name: profile.nickname,
                size: 52,
                ring: profile.isPremium,
                status: status,
              ),
              const SizedBox(height: 6),
              Text(
                profile.nickname,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: context.texts.labelSmall?.copyWith(fontWeight: FontWeight.w600),
              ),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: context.texts.labelSmall
                    ?.copyWith(color: context.scheme.onSurfaceVariant, fontSize: 10),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _EmptyFriends extends StatelessWidget {
  const _EmptyFriends({required this.hasAny});

  final bool hasAny;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
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
            child: Icon(Icons.people_alt_rounded,
                size: 22, color: context.scheme.onSurfaceVariant),
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            hasAny ? 'Сейчас никого нет в сети' : 'Пока нет друзей',
            style: context.texts.bodySmall
                ?.copyWith(color: context.scheme.onSurfaceVariant),
          ),
          const SizedBox(height: AppSpacing.xs),
          TextButton.icon(
            onPressed: () => context.push(AppRoutes.search),
            icon: Icon(Icons.person_add_rounded, size: 16, color: colors.neonCyan),
            label: Text(hasAny ? 'Открыть друзей' : 'Найти друзей'),
          ),
        ],
      ),
    );
  }
}
