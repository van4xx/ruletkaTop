import 'package:flutter/material.dart' hide Badge;

import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../../../auth/domain/auth_options.dart';
import '../../../economy/presentation/economy_format.dart';

/// The signature profile hero, shared by the own- and public-profile screens.
///
/// An aurora cover strip with the avatar overlapping it (premium → neon ring +
/// glow, optional presence dot), the nickname with inline contract badges, and
/// a wrap of meta chips: gender · age · country · languages · "в эфире с".
/// A trailing slot ([trailing]) hosts a screen-specific affordance (the edit
/// button on the own profile).
class ProfileHero extends StatelessWidget {
  const ProfileHero({
    super.key,
    required this.profile,
    this.status,
    this.trailing,
  });

  final PublicProfile profile;

  /// Live presence for the avatar dot (public profile). Null hides the dot.
  final OnlineStatus? status;

  /// Optional trailing action aligned to the identity row (e.g. edit).
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final isPremium = profile.isPremium;

    return GlassCard(
      padding: EdgeInsets.zero,
      glowColor: isPremium ? colors.neonViolet : null,
      glowStrength: 0.5,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Aurora cover strip.
          ClipRRect(
            borderRadius: const BorderRadius.vertical(
                top: Radius.circular(AppRadii.xl)),
            child: SizedBox(
              height: 92,
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
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Identity row — avatar overlaps the cover.
                Transform.translate(
                  offset: const Offset(0, -34),
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
                          imageUrl: profile.avatarUrl,
                          name: profile.nickname,
                          size: 88,
                          ring: isPremium,
                          glow: isPremium,
                          status: status,
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: Padding(
                          padding:
                              const EdgeInsets.only(bottom: AppSpacing.sm),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Row(
                                children: [
                                  Flexible(
                                    child: Text(
                                      profile.nickname.isEmpty
                                          ? '—'
                                          : profile.nickname,
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
                              if (profile.badges.isNotEmpty) ...[
                                const SizedBox(height: 6),
                                Wrap(
                                  spacing: 6,
                                  runSpacing: 6,
                                  children: [
                                    for (final b in profile.badges)
                                      UserBadgePill(badge: b),
                                  ],
                                ),
                              ],
                            ],
                          ),
                        ),
                      ),
                      ?trailing,
                    ],
                  ),
                ),
                // Pull the rest up so the negative-offset avatar leaves no gap.
                Transform.translate(
                  offset: const Offset(0, -18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if ((profile.status ?? '').trim().isNotEmpty) ...[
                        Text(
                          profile.status!.trim(),
                          style: context.texts.bodyMedium?.copyWith(
                              color: context.scheme.onSurface, height: 1.4),
                        ),
                        const SizedBox(height: AppSpacing.md),
                      ],
                      _MetaChips(profile: profile),
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

/// The wrap of profile meta chips: gender, age, country, each language and the
/// "в эфире с {год}" registration chip.
class _MetaChips extends StatelessWidget {
  const _MetaChips({required this.profile});

  final PublicProfile profile;

  @override
  Widget build(BuildContext context) {
    final genderLabel = kGenderChoices
        .firstWhere((c) => c.value == profile.gender,
            orElse: () => const Choice(Gender.other, 'Другое'))
        .label;
    final countryName = kCountryNameByCode[profile.country.toUpperCase()];

    return Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      children: [
        _Chip(icon: _genderIcon(profile.gender), label: genderLabel),
        _Chip(
          icon: Icons.cake_outlined,
          label: '${profile.age} ${EconomyFormat.plural(profile.age, 'год', 'года', 'лет')}',
        ),
        _Chip(
          leading: CountryFlag(countryCode: profile.country, size: 14),
          label: countryName ?? profile.country,
        ),
        for (final lang in profile.languages)
          _Chip(
            icon: Icons.translate_rounded,
            label: lang == Locale.ru ? 'Русский' : 'English',
          ),
        if (profile.createdAt.millisecondsSinceEpoch > 0)
          _Chip(
            icon: Icons.podcasts_rounded,
            label: 'в эфире с ${profile.createdAt.toLocal().year}',
            accent: true,
          ),
      ],
    );
  }

  static IconData _genderIcon(Gender g) => switch (g) {
        Gender.female => Icons.female_rounded,
        Gender.male => Icons.male_rounded,
        Gender.other => Icons.transgender_rounded,
      };
}

/// A single meta chip — a hairline pill with a leading glyph/flag and a label.
class _Chip extends StatelessWidget {
  const _Chip({
    this.icon,
    this.leading,
    required this.label,
    this.accent = false,
  });

  final IconData? icon;
  final Widget? leading;
  final String label;

  /// Tint the chip with the neon-cyan accent (used for the "on air since" chip).
  final bool accent;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final fg = accent ? colors.neonCyan : context.scheme.onSurfaceVariant;

    return Container(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md, vertical: 7),
      decoration: BoxDecoration(
        borderRadius: AppRadii.brPill,
        color: accent
            ? colors.neonCyan.withValues(alpha: 0.12)
            : context.scheme.surfaceContainerHighest.withValues(alpha: 0.5),
        border: Border.all(
          color: accent
              ? colors.neonCyan.withValues(alpha: 0.35)
              : colors.glassBorder,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (leading != null)
            leading!
          else if (icon != null)
            Icon(icon, size: 14, color: fg),
          const SizedBox(width: 6),
          Text(
            label,
            style: context.texts.labelMedium
                ?.copyWith(color: accent ? fg : context.scheme.onSurface),
          ),
        ],
      ),
    );
  }
}
