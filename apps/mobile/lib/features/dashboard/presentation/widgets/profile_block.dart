import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/di/di.dart';
import '../../../../core/router/routes.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../dashboard_providers.dart';

/// The dashboard identity block — a compact "who am I" panel mirroring the web:
///   • an aurora cover strip with the avatar overlapping it
///   • nickname + premium crown + account-type line (with country flag)
///   • a balance row with a prominent "Пополнить" action
///   • a "Кто смотрел профиль" teaser (premium → count; otherwise an upsell)
///   • a quick edit affordance routing to the profile editor
///
/// Each sub-area degrades independently (the session user backs the nickname
/// while the rich profile/wallet load).
class ProfileBlock extends ConsumerWidget {
  const ProfileBlock({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = context.colors;
    final user = ref.watch(currentUserProvider);
    final profileAsync = ref.watch(myProfileProvider);
    final walletAsync = ref.watch(walletProvider);

    final profile = profileAsync.value;
    final isPremium = profile?.isPremium ?? user?.isPremium ?? false;
    final nickname = profile?.nickname ?? user?.nickname ?? '—';

    return GlassCard(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Aurora cover strip.
          ClipRRect(
            borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadii.xl)),
            child: SizedBox(
              height: 76,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      colors.neonViolet.withValues(alpha: 0.45),
                      colors.neonMagenta.withValues(alpha: 0.30),
                      colors.neonCyan.withValues(alpha: 0.35),
                    ],
                  ),
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Identity row — avatar overlaps the cover.
                Transform.translate(
                  offset: const Offset(0, -28),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Container(
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(
                              color: context.scheme.surface, width: 3),
                        ),
                        child: NeonAvatar(
                          imageUrl: profile?.avatarUrl,
                          name: nickname,
                          size: 72,
                          ring: isPremium,
                          glow: isPremium,
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Row(
                                children: [
                                  Flexible(
                                    child: Text(
                                      nickname,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: context.texts.headlineSmall,
                                    ),
                                  ),
                                  if (isPremium) ...[
                                    const SizedBox(width: AppSpacing.xs),
                                    Icon(Icons.workspace_premium_rounded,
                                        size: 18, color: colors.warning),
                                  ],
                                ],
                              ),
                              const SizedBox(height: 2),
                              if (profile != null)
                                Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    CountryFlag(
                                        countryCode: profile.country, size: 14),
                                    const SizedBox(width: 6),
                                    Flexible(
                                      child: Text(
                                        isPremium
                                            ? 'Премиум-аккаунт'
                                            : 'Базовый аккаунт',
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: context.texts.bodySmall?.copyWith(
                                            color: context
                                                .scheme.onSurfaceVariant),
                                      ),
                                    ),
                                  ],
                                )
                              else
                                const ShimmerBox(width: 110, height: 12),
                            ],
                          ),
                        ),
                      ),
                      // Edit affordance.
                      IconButton.filledTonal(
                        onPressed: () => context.go(AppRoutes.me),
                        icon: const Icon(Icons.edit_rounded, size: 18),
                        tooltip: 'Редактировать профиль',
                        visualDensity: VisualDensity.compact,
                      ),
                    ],
                  ),
                ),
                // Pull the rest up so the negative-offset avatar doesn't leave a gap.
                Transform.translate(
                  offset: const Offset(0, -16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _BalanceRow(
                        balance: walletAsync.value?.balanceCoins,
                        loading: walletAsync.isLoading,
                      ),
                      const SizedBox(height: AppSpacing.md),
                      _ProfileViewsTeaser(
                        isPremium: isPremium,
                        views: profile?.profileViews,
                        loading: profileAsync.isLoading,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _BalanceRow extends StatelessWidget {
  const _BalanceRow({required this.balance, required this.loading});

  final int? balance;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        borderRadius: AppRadii.brXl,
        color: context.scheme.surfaceContainerHighest.withValues(alpha: 0.4),
        border: Border.all(color: colors.glassBorder),
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              borderRadius: AppRadii.brMd,
              color: colors.warning.withValues(alpha: 0.16),
            ),
            child: Icon(Icons.monetization_on_rounded,
                size: 20, color: colors.warning),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'БАЛАНС',
                  style: context.texts.labelSmall?.copyWith(
                      color: context.scheme.onSurfaceVariant,
                      letterSpacing: 0.6),
                ),
                const SizedBox(height: 2),
                if (loading)
                  const ShimmerBox(width: 70, height: 18)
                else
                  RichText(
                    text: TextSpan(
                      style: context.texts.titleLarge,
                      children: [
                        TextSpan(text: balance != null ? _format(balance!) : '—'),
                        TextSpan(
                          text: ' монет',
                          style: context.texts.bodySmall?.copyWith(
                              color: context.scheme.onSurfaceVariant),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          GradientButton(
            label: 'Пополнить',
            icon: Icons.add_rounded,
            fullWidth: false,
            height: 40,
            glow: false,
            onPressed: () => context.go(AppRoutes.coins),
          ),
        ],
      ),
    );
  }

  static String _format(int value) {
    final s = value.abs().toString();
    final buf = StringBuffer(value < 0 ? '-' : '');
    for (var i = 0; i < s.length; i++) {
      if (i != 0 && (s.length - i) % 3 == 0) buf.write(' ');
      buf.write(s[i]);
    }
    return buf.toString();
  }
}

/// "Кто смотрел профиль" — a count for premium users, an upsell otherwise.
class _ProfileViewsTeaser extends StatelessWidget {
  const _ProfileViewsTeaser({
    required this.isPremium,
    required this.views,
    required this.loading,
  });

  final bool isPremium;
  final int? views;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;

    if (loading) {
      return Container(
        height: 60,
        decoration: BoxDecoration(
          borderRadius: AppRadii.brXl,
          color: context.scheme.surfaceContainerHighest.withValues(alpha: 0.4),
        ),
      );
    }

    if (isPremium) {
      return Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          borderRadius: AppRadii.brXl,
          color: context.scheme.surfaceContainerHighest.withValues(alpha: 0.4),
          border: Border.all(color: colors.glassBorder),
        ),
        child: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                borderRadius: AppRadii.brMd,
                color: colors.neonCyan.withValues(alpha: 0.16),
              ),
              child: Icon(Icons.visibility_rounded,
                  size: 20, color: colors.neonCyan),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'КТО СМОТРЕЛ ПРОФИЛЬ',
                    style: context.texts.labelSmall?.copyWith(
                        color: context.scheme.onSurfaceVariant,
                        letterSpacing: 0.6),
                  ),
                  const SizedBox(height: 2),
                  RichText(
                    text: TextSpan(
                      style: context.texts.titleLarge,
                      children: [
                        TextSpan(text: '${views ?? 0}'),
                        TextSpan(
                          text: ' просмотров',
                          style: context.texts.bodySmall?.copyWith(
                              color: context.scheme.onSurfaceVariant),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    }

    // Non-premium upsell.
    return GlassCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      blurSigma: 0,
      onTap: () => context.go(AppRoutes.premium),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              borderRadius: AppRadii.brMd,
              color: context.scheme.surfaceContainerHighest,
            ),
            child: Icon(Icons.lock_outline_rounded,
                size: 18, color: context.scheme.onSurfaceVariant),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Кто смотрел профиль',
                    style: context.texts.titleSmall),
                Text(
                  'Доступно с Премиумом',
                  style: context.texts.bodySmall
                      ?.copyWith(color: context.scheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.sm, vertical: 4),
            decoration: BoxDecoration(
              borderRadius: AppRadii.brPill,
              color: colors.neonViolet.withValues(alpha: 0.16),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.auto_awesome_rounded,
                    size: 12, color: colors.neonViolet),
                const SizedBox(width: 4),
                Text(
                  'Премиум',
                  style: context.texts.labelSmall
                      ?.copyWith(color: colors.neonViolet),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
