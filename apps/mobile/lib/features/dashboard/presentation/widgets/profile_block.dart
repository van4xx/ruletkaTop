import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/di/di.dart';
import '../../../../core/models/models.dart';
import '../../../../core/router/routes.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../dashboard_providers.dart';

/// The dashboard identity block — a premium "who am I" hero mirroring the web:
///   • an aurora cover strip (gradient + radial bloom) with the avatar
///     overlapping it
///   • nickname + premium crown + an account-type / status chip row
///   • a neon balance stat with a prominent "Пополнить" action
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
      intensity: 1.15,
      glowColor: isPremium ? colors.neonViolet : null,
      glowStrength: 0.5,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Aurora cover strip: brand gradient with a soft radial bloom.
          ClipRRect(
            borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadii.xl)),
            child: SizedBox(
              height: 84,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          colors.neonViolet.withValues(alpha: 0.50),
                          colors.neonMagenta.withValues(alpha: 0.32),
                          colors.neonCyan.withValues(alpha: 0.38),
                        ],
                      ),
                    ),
                  ),
                  DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: RadialGradient(
                        center: const Alignment(-0.7, -1.4),
                        radius: 1.2,
                        colors: [
                          colors.neonViolet.withValues(alpha: 0.55),
                          Colors.transparent,
                        ],
                        stops: const [0.0, 0.6],
                      ),
                    ),
                  ),
                  // A soft specular sheen along the cover's top edge.
                  Align(
                    alignment: Alignment.topCenter,
                    child: Container(
                      height: 1,
                      color: colors.glassHighlight.withValues(alpha: 0.5),
                    ),
                  ),
                ],
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
                  offset: const Offset(0, -30),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Container(
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(
                              color: context.scheme.surface, width: 3),
                          boxShadow: isPremium
                              ? AppShadows.glow(colors.neonViolet, strength: 0.5)
                              : null,
                        ),
                        child: NeonAvatar(
                          imageUrl: profile?.avatarUrl,
                          name: nickname,
                          size: 76,
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
                              const SizedBox(height: 6),
                              _IdentityChips(
                                profile: profile,
                                isPremium: isPremium,
                                loading: profileAsync.isLoading,
                              ),
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
                  offset: const Offset(0, -18),
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

/// The status line under the nickname: a flag + account-type pill and a small
/// "online" presence chip, mirroring the web's identity meta row.
class _IdentityChips extends StatelessWidget {
  const _IdentityChips({
    required this.profile,
    required this.isPremium,
    required this.loading,
  });

  final PublicProfile? profile;
  final bool isPremium;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;

    if (profile == null) {
      return loading
          ? const ShimmerBox(width: 130, height: 22)
          : const SizedBox.shrink();
    }

    return Wrap(
      spacing: 6,
      runSpacing: 6,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        _MetaPill(
          color: isPremium ? colors.warning : context.scheme.onSurfaceVariant,
          tinted: isPremium,
          leading: CountryFlag(countryCode: profile!.country, size: 13),
          label: isPremium ? 'Премиум-аккаунт' : 'Базовый аккаунт',
        ),
        _MetaPill(
          color: colors.success,
          tinted: true,
          dot: true,
          label: 'В сети',
        ),
      ],
    );
  }
}

/// A compact meta pill — either tinted (filled) or hairline — with an optional
/// leading widget or status dot.
class _MetaPill extends StatelessWidget {
  const _MetaPill({
    required this.color,
    required this.label,
    this.leading,
    this.dot = false,
    this.tinted = false,
  });

  final Color color;
  final String label;
  final Widget? leading;
  final bool dot;
  final bool tinted;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 3),
      decoration: BoxDecoration(
        borderRadius: AppRadii.brPill,
        color: tinted
            ? color.withValues(alpha: 0.14)
            : context.scheme.surfaceContainerHighest.withValues(alpha: 0.5),
        border: Border.all(
          color: tinted ? color.withValues(alpha: 0.30) : context.colors.glassBorder,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (leading != null) ...[
            leading!,
            const SizedBox(width: 5),
          ] else if (dot) ...[
            Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(shape: BoxShape.circle, color: color),
            ),
            const SizedBox(width: 5),
          ],
          Text(
            label,
            style: context.texts.labelSmall?.copyWith(
              color: tinted ? color : context.scheme.onSurfaceVariant,
              fontWeight: FontWeight.w700,
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
    return _StatTile(
      iconColor: colors.warning,
      icon: Icons.monetization_on_rounded,
      label: 'БАЛАНС',
      loading: loading,
      value: balance != null ? _format(balance!) : '—',
      unit: 'монет',
      trailing: GradientButton(
        label: 'Пополнить',
        icon: Icons.add_rounded,
        fullWidth: false,
        height: 40,
        glow: false,
        onPressed: () => context.push(AppRoutes.coins),
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
        height: 66,
        decoration: BoxDecoration(
          borderRadius: AppRadii.brXl,
          color: context.scheme.surfaceContainerHighest.withValues(alpha: 0.4),
        ),
      );
    }

    if (isPremium) {
      return _StatTile(
        iconColor: colors.neonCyan,
        icon: Icons.visibility_rounded,
        label: 'КТО СМОТРЕЛ ПРОФИЛЬ',
        loading: false,
        value: '${views ?? 0}',
        unit: 'просмотров',
      );
    }

    // Non-premium upsell.
    return GlassCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      blurSigma: 0,
      intensity: 0.6,
      onTap: () => context.push(AppRoutes.premium),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
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
                Text('Кто смотрел профиль', style: context.texts.titleSmall),
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

/// A neon-iconed stat row used for the balance + profile-views surfaces: a
/// tinted glyph chip, an eyebrow label over a [stat]-styled value (+ unit), and
/// an optional trailing action.
class _StatTile extends StatelessWidget {
  const _StatTile({
    required this.icon,
    required this.iconColor,
    required this.label,
    required this.value,
    required this.unit,
    required this.loading,
    this.trailing,
  });

  final IconData icon;
  final Color iconColor;
  final String label;
  final String value;
  final String unit;
  final bool loading;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        borderRadius: AppRadii.brXl,
        color: context.scheme.surfaceContainerHighest.withValues(alpha: 0.42),
        border: Border.all(color: colors.glassBorder),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              borderRadius: AppRadii.brMd,
              color: iconColor.withValues(alpha: 0.16),
              border: Border.all(color: iconColor.withValues(alpha: 0.28)),
            ),
            child: Icon(icon, size: 20, color: iconColor),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: context.texts.labelSmall?.copyWith(
                      color: context.scheme.onSurfaceVariant, letterSpacing: 0.8),
                ),
                const SizedBox(height: 3),
                if (loading)
                  const ShimmerBox(width: 72, height: 18)
                else
                  RichText(
                    text: TextSpan(
                      style: AppTypography.stat(
                          fontSize: 18, color: context.scheme.onSurface),
                      children: [
                        TextSpan(text: value),
                        TextSpan(
                          text: ' $unit',
                          style: context.texts.bodySmall?.copyWith(
                              color: context.scheme.onSurfaceVariant),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          if (trailing != null) ...[
            const SizedBox(width: AppSpacing.sm),
            trailing!,
          ],
        ],
      ),
    );
  }
}
