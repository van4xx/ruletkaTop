import 'package:flutter/material.dart' hide Badge;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/di/di.dart';
import '../../../../core/models/models.dart';
import '../../../../core/router/routes.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../widgets/settings_primitives.dart';

/// Account section — the caller's identity (avatar, nickname, premium badge),
/// the read-only login email and a shortcut to the full profile editor (which
/// lives in the profile screen). Email is immutable here (matches the web:
/// changing it goes through support).
class AccountSection extends ConsumerWidget {
  const AccountSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider);
    final scheme = context.scheme;

    return SettingsSection(
      title: 'Аккаунт',
      description: 'Данные вашей учётной записи.',
      icon: Icons.person_outline_rounded,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
          child: Row(
            children: [
              NeonAvatar(
                imageUrl: null,
                name: user?.nickname,
                size: 56,
                ring: user?.isPremium ?? false,
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
                            user?.nickname ?? '—',
                            overflow: TextOverflow.ellipsis,
                            style: context.texts.titleMedium,
                          ),
                        ),
                        if (user?.isPremium ?? false) ...[
                          const SizedBox(width: AppSpacing.sm),
                          const UserBadgePill(badge: Badge.premium),
                        ],
                        if (user?.role.isStaff ?? false) ...[
                          const SizedBox(width: AppSpacing.sm),
                          const UserBadgePill(badge: Badge.staff),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      user?.email ?? '',
                      style: context.texts.bodySmall
                          ?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SettingRowDivider(),
        SettingRow(
          label: 'Редактировать профиль',
          description: 'Аватар, никнейм, о себе.',
          control: IconButton(
            onPressed: () => context.go(AppRoutes.me),
            icon: const Icon(Icons.chevron_right_rounded),
            tooltip: 'Открыть профиль',
          ),
        ),
        const SettingRowDivider(),
        SettingRow(
          label: 'Email',
          description: 'Для входа. Чтобы изменить — напишите в поддержку.',
          control: Icon(Icons.lock_outline_rounded,
              size: 18, color: scheme.onSurfaceVariant),
        ),
      ],
    );
  }
}
