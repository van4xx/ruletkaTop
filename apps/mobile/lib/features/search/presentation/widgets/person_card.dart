// Hide Flutter's Badge widget: this card renders the contract `Badge` enum.
import 'package:flutter/material.dart' hide Badge;

import '../../../../core/models/models.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';

/// A discovery result card: a ringed [NeonAvatar] (premium → glowing ring +
/// live presence dot), the nickname with an optional verified tick, a country
/// flag + age line, and a profile-views teaser. Taps through to the profile.
class PersonCard extends StatelessWidget {
  const PersonCard({
    super.key,
    required this.profile,
    required this.onTap,
    this.status,
  });

  final PublicProfile profile;
  final VoidCallback onTap;

  /// Live presence (drives the avatar dot). `null` → no dot.
  final OnlineStatus? status;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final isVerified = profile.badges.contains(Badge.verified);

    return GlassCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      glowColor: profile.isPremium ? colors.neonViolet : null,
      glowStrength: 0.35,
      onTap: onTap,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          NeonAvatar(
            imageUrl: profile.avatarUrl,
            name: profile.nickname,
            size: 64,
            ring: profile.isPremium,
            glow: profile.isPremium,
            status: status,
          ),
          const SizedBox(height: AppSpacing.sm),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Flexible(
                child: Text(
                  profile.nickname,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: context.texts.titleSmall
                      ?.copyWith(fontWeight: FontWeight.w700),
                ),
              ),
              if (isVerified) ...[
                const SizedBox(width: 4),
                Icon(Icons.verified_rounded, size: 15, color: colors.neonCyan),
              ],
            ],
          ),
          const SizedBox(height: 4),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              CountryFlag(countryCode: profile.country, size: 14),
              const SizedBox(width: 6),
              Text(
                '${profile.age} ${_yearsLabel(profile.age)}',
                style: context.texts.bodySmall
                    ?.copyWith(color: context.scheme.onSurfaceVariant),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.visibility_outlined,
                  size: 13, color: context.scheme.onSurfaceVariant),
              const SizedBox(width: 4),
              Text(
                '${profile.profileViews}',
                style: context.texts.labelSmall
                    ?.copyWith(color: context.scheme.onSurfaceVariant),
              ),
              if (profile.isPremium) ...[
                const SizedBox(width: AppSpacing.sm),
                Icon(Icons.workspace_premium_rounded,
                    size: 13, color: colors.warning),
              ],
            ],
          ),
        ],
      ),
    );
  }

  /// Russian-correct plural for years: 1 год, 2 года, 5 лет.
  static String _yearsLabel(int n) {
    final mod10 = n % 10;
    final mod100 = n % 100;
    if (mod10 == 1 && mod100 != 11) return 'год';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'года';
    return 'лет';
  }
}
