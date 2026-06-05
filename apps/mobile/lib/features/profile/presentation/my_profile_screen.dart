import 'package:flutter/material.dart' hide Badge;
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/di.dart';
import '../../../core/models/models.dart';
import '../../../core/router/routes.dart';
import '../../../core/theme/theme.dart';
import '../../../core/widgets/widgets.dart';
import '../../auth/domain/auth_options.dart';
import '../../dashboard/presentation/dashboard_providers.dart';
import 'profile_providers.dart';
import 'widgets/gift_showcase_section.dart';
import 'widgets/interests.dart';
import 'widgets/interests_editor.dart';
import 'widgets/profile_hero.dart';
import 'widgets/profile_section.dart';
import 'widgets/profile_stats_strip.dart';

/// `/profile/me` — the caller's own profile (a bottom-nav tab). Composes the
/// shared hero + a stats strip (received-gifts value, profile views, friends,
/// distinct gifts), the received-gifts showcase and an actions panel (edit,
/// settings, copy id, change avatar).
///
/// Editing is inline: tapping "Редактировать" swaps the hero/actions for an
/// edit form backed by [profileEditProvider]; saving PATCHes the profile and
/// refreshes the cached own-profile + dashboard profile.
class MyProfileScreen extends ConsumerStatefulWidget {
  const MyProfileScreen({super.key});

  @override
  ConsumerState<MyProfileScreen> createState() => _MyProfileScreenState();
}

class _MyProfileScreenState extends ConsumerState<MyProfileScreen> {
  bool _editing = false;

  void _enterEdit() => setState(() => _editing = true);
  void _exitEdit() => setState(() => _editing = false);

  Future<void> _refresh() async {
    ref.invalidate(myProfileDetailProvider);
    ref.invalidate(friendsProvider);
    final selfId = ref.read(currentUserIdProvider);
    if (selfId != null) ref.invalidate(giftShowcaseProvider(selfId));
    try {
      await ref.read(myProfileDetailProvider.future);
    } catch (_) {/* error surface handles it */}
  }

  @override
  Widget build(BuildContext context) {
    final profileAsync = ref.watch(myProfileDetailProvider);

    return AppScaffold(
      title: 'Мой профиль',
      currentRoute: AppRoutes.me,
      actions: [
        if (!_editing)
          IconButton(
            tooltip: 'Настройки',
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => context.push(AppRoutes.settings),
          ),
        const SizedBox(width: AppSpacing.xs),
      ],
      body: profileAsync.when(
        loading: () => const _MyProfileSkeleton(),
        error: (_, _) => ErrorView(
          title: 'Не удалось загрузить профиль',
          message: 'Проверьте соединение и попробуйте снова.',
          onRetry: () => ref.invalidate(myProfileDetailProvider),
        ),
        data: (profile) {
          if (_editing) {
            return _ProfileEditForm(
              profile: profile,
              onCancel: _exitEdit,
              onSaved: (_) {
                // Refresh dependent caches so the hero/dashboard reflect edits.
                ref.invalidate(myProfileDetailProvider);
                ref.invalidate(myProfileProvider);
                _exitEdit();
              },
            );
          }
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.lg,
                  AppSpacing.lg, AppSpacing.xxxl),
              children: [
                ProfileHero(
                  profile: profile,
                  trailing: IconButton.filledTonal(
                    onPressed: _enterEdit,
                    icon: const Icon(Icons.edit_rounded, size: 18),
                    tooltip: 'Редактировать профиль',
                    visualDensity: VisualDensity.compact,
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                _MyStats(profile: profile),
                const SizedBox(height: AppSpacing.lg),
                ProfileSection(
                  icon: Icons.interests_rounded,
                  title: 'Интересы',
                  trailing: IconButton(
                    visualDensity: VisualDensity.compact,
                    icon: const Icon(Icons.edit_rounded, size: 16),
                    tooltip: 'Изменить интересы',
                    onPressed: _enterEdit,
                  ),
                  child: profile.interests.isEmpty
                      ? _InterestsEmpty(onAdd: _enterEdit)
                      : InterestChips(interests: profile.interests),
                ),
                const SizedBox(height: AppSpacing.lg),
                _ActionsPanel(profile: profile, onEdit: _enterEdit),
                const SizedBox(height: AppSpacing.lg),
                GiftShowcaseSection(
                  userId: profile.id,
                  emptyMessage:
                      'Вам пока не дарили подарков — они появятся здесь.',
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// The own-profile stats strip: received-gifts value, profile views, friends
/// count (from [friendsProvider]) and the number of distinct gifts received.
class _MyStats extends ConsumerWidget {
  const _MyStats({required this.profile});

  final PublicProfile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = context.colors;
    final showcaseAsync = ref.watch(giftShowcaseProvider(profile.id));
    final showcase = showcaseAsync.value;
    final showcaseLoading = showcaseAsync.isLoading;

    final friendsAsync = ref.watch(friendsProvider);

    return ProfileStatsStrip(
      stats: [
        ProfileStat(
          icon: Icons.card_giftcard_rounded,
          value: _format(showcase?.totalValueCoins ?? 0),
          label: 'Подарки',
          accent: colors.neonMagenta,
          loading: showcaseLoading,
        ),
        ProfileStat(
          icon: Icons.visibility_rounded,
          value: _format(profile.profileViews),
          label: 'Просмотры',
          accent: colors.neonCyan,
        ),
        ProfileStat(
          icon: Icons.people_alt_rounded,
          value: _format(friendsAsync.value?.length ?? 0),
          label: 'Друзья',
          accent: colors.neonViolet,
          loading: friendsAsync.isLoading,
        ),
        ProfileStat(
          icon: profile.isPremium
              ? Icons.workspace_premium_rounded
              : Icons.auto_awesome_rounded,
          value: '${showcase?.distinctCount ?? 0}',
          label: 'Видов\nподарков',
          accent: colors.warning,
          loading: showcaseLoading,
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

/// The own-profile actions: edit, settings, share/copy id, change avatar (which
/// opens the inline editor focused on the avatar URL). Each is a glassy row.
class _ActionsPanel extends StatelessWidget {
  const _ActionsPanel({required this.profile, required this.onEdit});

  final PublicProfile profile;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    return GlassCard(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.sm, vertical: AppSpacing.xs),
      child: Column(
        children: [
          _ActionRow(
            icon: Icons.edit_rounded,
            label: 'Редактировать профиль',
            subtitle: 'Никнейм, о себе, страна, языки, интересы',
            onTap: onEdit,
          ),
          const _ActionDivider(),
          _ActionRow(
            icon: Icons.image_outlined,
            label: 'Сменить аватар',
            subtitle: 'Обновите ссылку на фото',
            onTap: onEdit,
          ),
          const _ActionDivider(),
          _ActionRow(
            icon: Icons.tag_rounded,
            label: 'Скопировать ID',
            subtitle: profile.id,
            onTap: () async {
              await Clipboard.setData(ClipboardData(text: profile.id));
              if (context.mounted) {
                ScaffoldMessenger.of(context)
                  ..hideCurrentSnackBar()
                  ..showSnackBar(
                      const SnackBar(content: Text('ID скопирован')));
              }
            },
          ),
          const _ActionDivider(),
          _ActionRow(
            icon: Icons.settings_outlined,
            label: 'Настройки',
            subtitle: 'Приватность, уведомления, аккаунт',
            onTap: () => context.push(AppRoutes.settings),
          ),
        ],
      ),
    );
  }
}

class _ActionRow extends StatelessWidget {
  const _ActionRow({
    required this.icon,
    required this.label,
    required this.onTap,
    this.subtitle,
  });

  final IconData icon;
  final String label;
  final String? subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return InkWell(
      onTap: onTap,
      borderRadius: AppRadii.brMd,
      child: Padding(
        padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.sm, vertical: AppSpacing.md),
        child: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                borderRadius: AppRadii.brMd,
                color: colors.neonViolet.withValues(alpha: 0.14),
              ),
              child: Icon(icon, size: 19, color: colors.neonViolet),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: context.texts.titleSmall),
                  if (subtitle != null) ...[
                    const SizedBox(height: 1),
                    Text(
                      subtitle!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: context.texts.bodySmall
                          ?.copyWith(color: context.scheme.onSurfaceVariant),
                    ),
                  ],
                ],
              ),
            ),
            Icon(Icons.chevron_right_rounded,
                color: context.scheme.onSurfaceVariant),
          ],
        ),
      ),
    );
  }
}

class _ActionDivider extends StatelessWidget {
  const _ActionDivider();

  @override
  Widget build(BuildContext context) {
    return Divider(
      height: 1,
      indent: AppSpacing.sm,
      endIndent: AppSpacing.sm,
      color: context.colors.glassBorder,
    );
  }
}

/// The inline profile editor: nickname, status/bio, avatar URL, gender, country
/// and languages. Submits only the changed fields via [profileEditProvider].
class _ProfileEditForm extends ConsumerStatefulWidget {
  const _ProfileEditForm({
    required this.profile,
    required this.onCancel,
    required this.onSaved,
  });

  final PublicProfile profile;
  final VoidCallback onCancel;
  final ValueChanged<PublicProfile> onSaved;

  @override
  ConsumerState<_ProfileEditForm> createState() => _ProfileEditFormState();
}

class _ProfileEditFormState extends ConsumerState<_ProfileEditForm> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nickname;
  late final TextEditingController _status;
  late final TextEditingController _avatarUrl;
  late Gender _gender;
  late String _country;
  late Set<Locale> _languages;
  late List<String> _interests;

  @override
  void initState() {
    super.initState();
    final p = widget.profile;
    _nickname = TextEditingController(text: p.nickname);
    _status = TextEditingController(text: p.status ?? '');
    _avatarUrl = TextEditingController(text: p.avatarUrl ?? '');
    _gender = p.gender;
    _country = p.country.toUpperCase();
    _languages = p.languages.toSet();
    _interests = List<String>.from(p.interests);
  }

  @override
  void dispose() {
    _nickname.dispose();
    _status.dispose();
    _avatarUrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final editState = ref.watch(profileEditProvider);
    final saving = editState.isSaving;

    // Surface save errors as a snackbar (success is handled by the result).
    ref.listen(profileEditProvider, (prev, next) {
      if (next.status == ProfileEditStatus.error &&
          next.message != null &&
          next.message != prev?.message) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(next.message!)));
      }
    });

    return AbsorbPointer(
      absorbing: saving,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.xxxl),
        children: [
          Row(
            children: [
              Expanded(
                child: Text('Редактирование', style: context.texts.headlineSmall),
              ),
              TextButton(
                onPressed: saving ? null : widget.onCancel,
                child: const Text('Отмена'),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          GlassCard(
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Avatar preview from the current URL field.
                  Center(
                    child: NeonAvatar(
                      imageUrl: _avatarUrl.text.trim().isEmpty
                          ? null
                          : _avatarUrl.text.trim(),
                      name: _nickname.text,
                      size: 84,
                      ring: widget.profile.isPremium,
                      glow: widget.profile.isPremium,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  TextFormField(
                    controller: _avatarUrl,
                    keyboardType: TextInputType.url,
                    textInputAction: TextInputAction.next,
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(
                      labelText: 'Ссылка на аватар',
                      hintText: 'https://…',
                      prefixIcon: Icon(Icons.image_outlined),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  TextFormField(
                    controller: _nickname,
                    textInputAction: TextInputAction.next,
                    maxLength: 32,
                    decoration: const InputDecoration(
                      labelText: 'Никнейм',
                      prefixIcon: Icon(Icons.person_outline_rounded),
                    ),
                    validator: (v) {
                      final t = (v ?? '').trim();
                      if (t.isEmpty) return 'Введите никнейм';
                      if (t.length < 2) return 'Минимум 2 символа';
                      return null;
                    },
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  TextFormField(
                    controller: _status,
                    maxLength: 160,
                    maxLines: 3,
                    minLines: 1,
                    decoration: const InputDecoration(
                      labelText: 'О себе',
                      hintText: 'Пара слов о вас',
                      alignLabelWithHint: true,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  _FieldLabel('Пол'),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    children: [
                      for (final c in kGenderChoices)
                        ChoiceChip(
                          label: Text(c.label),
                          selected: _gender == c.value,
                          onSelected: (_) =>
                              setState(() => _gender = c.value),
                        ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  _FieldLabel('Страна'),
                  const SizedBox(height: AppSpacing.sm),
                  DropdownButtonFormField<String>(
                    initialValue: kCountryNameByCode.containsKey(_country)
                        ? _country
                        : null,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      prefixIcon: Icon(Icons.public_rounded),
                    ),
                    items: [
                      for (final c in kCountries)
                        DropdownMenuItem(
                          value: c.code,
                          child: Row(
                            children: [
                              CountryFlag(countryCode: c.code, size: 16),
                              const SizedBox(width: AppSpacing.sm),
                              Flexible(
                                child: Text(c.name,
                                    overflow: TextOverflow.ellipsis),
                              ),
                            ],
                          ),
                        ),
                    ],
                    onChanged: (v) {
                      if (v != null) setState(() => _country = v);
                    },
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  _FieldLabel('Языки'),
                  const SizedBox(height: AppSpacing.sm),
                  Wrap(
                    spacing: AppSpacing.sm,
                    children: [
                      for (final c in kLocaleChoices)
                        FilterChip(
                          label: Text(c.label),
                          selected: _languages.contains(c.value),
                          onSelected: (on) => setState(() {
                            if (on) {
                              _languages.add(c.value);
                            } else {
                              _languages.remove(c.value);
                            }
                          }),
                        ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  _FieldLabel('Интересы'),
                  const SizedBox(height: AppSpacing.sm),
                  InterestsEditor(
                    selected: _interests,
                    onChanged: (next) => setState(() => _interests = next),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          GradientButton(
            label: 'Сохранить',
            icon: Icons.check_rounded,
            loading: saving,
            onPressed: _submit,
          ),
        ],
      ),
    );
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    final p = widget.profile;
    final nickname = _nickname.text.trim();
    final status = _status.text.trim();
    final avatar = _avatarUrl.text.trim();
    final languages = _languages.toList(growable: false);
    final interests = _interests.toList(growable: false);

    // Diff against the original so we PATCH only what changed.
    final dto = UpdateProfileDto(
      nickname: nickname != p.nickname ? nickname : null,
      status: status != (p.status ?? '') ? status : null,
      avatarUrl: avatar != (p.avatarUrl ?? '') ? avatar : null,
      gender: _gender != p.gender ? _gender : null,
      country: _country != p.country.toUpperCase() ? _country : null,
      languages: !_sameLanguages(languages, p.languages) ? languages : null,
      interests: !_sameInterests(interests, p.interests) ? interests : null,
    );

    final updated =
        await ref.read(profileEditProvider.notifier).save(dto);
    if (!mounted) return;
    if (updated != null) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(const SnackBar(content: Text('Профиль обновлён')));
      widget.onSaved(updated);
    }
  }

  static bool _sameLanguages(List<Locale> a, List<Locale> b) {
    if (a.length != b.length) return false;
    final sa = a.toSet();
    return b.every(sa.contains);
  }

  /// Interests are an ordered list, so compare element-by-element (a reorder is
  /// a real change worth PATCHing).
  static bool _sameInterests(List<String> a, List<String> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }
}

/// The empty interests prompt on the own profile — invites the user to add some.
class _InterestsEmpty extends StatelessWidget {
  const _InterestsEmpty({required this.onAdd});

  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            'Добавьте интересы — мы будем чаще подбирать собеседников с похожими увлечениями.',
            style: context.texts.bodySmall
                ?.copyWith(color: context.scheme.onSurfaceVariant, height: 1.35),
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        TextButton.icon(
          onPressed: onAdd,
          icon: const Icon(Icons.add_rounded, size: 18),
          label: const Text('Добавить'),
        ),
      ],
    );
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: context.texts.labelSmall?.copyWith(
        color: context.scheme.onSurfaceVariant,
        letterSpacing: 0.6,
        fontWeight: FontWeight.w700,
      ),
    );
  }
}

class _MyProfileSkeleton extends StatelessWidget {
  const _MyProfileSkeleton();

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
            height: 220,
            decoration: BoxDecoration(
              borderRadius: AppRadii.brXl,
              color: context.scheme.surfaceContainerHighest,
            ),
          ),
        ],
      ),
    );
  }
}
