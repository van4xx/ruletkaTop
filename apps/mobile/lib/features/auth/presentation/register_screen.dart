import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/di.dart';
import '../../../core/models/models.dart';
import '../../../core/router/routes.dart';
import '../../../core/theme/theme.dart';
import '../../../core/widgets/widgets.dart';
import '../domain/auth_options.dart';
import '../domain/auth_validators.dart';
import 'widgets/auth_form_fields.dart';
import 'widgets/auth_shell.dart';

/// The registration screen — a single-card form mirroring `registerSchema`:
/// email, password (+ strength meter), nickname, gender, birth date (18+ gate),
/// country, interface language and the Terms/Privacy consent (`acceptedTerms`,
/// which the API requires to be `true`).
///
/// On success the auth controller persists tokens + connects the socket; the
/// router guard then redirects to `/dashboard`.
class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _nicknameController = TextEditingController();

  Gender _gender = Gender.female;
  Locale _locale = Locale.ru;
  String? _country;
  DateTime? _birthDate;
  bool _acceptedTerms = false;

  // Validation for the non-TextFormField pickers is surfaced manually (they
  // aren't part of the Form's auto-validation), gated on a submit attempt.
  bool _submitted = false;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _nicknameController.dispose();
    super.dispose();
  }

  void _clearError() => ref.read(authControllerProvider.notifier).clearError();

  String? get _countryError =>
      _submitted ? AuthValidators.country(_country) : null;
  String? get _birthDateError =>
      _submitted ? AuthValidators.birthDate(_birthDate) : null;

  Future<void> _submit() async {
    setState(() => _submitted = true);
    final formOk = _formKey.currentState?.validate() ?? false;
    final pickersOk = _countryError == null && _birthDateError == null;
    if (!formOk || !pickersOk) return;
    if (!_acceptedTerms) return; // button is disabled, but guard anyway.

    FocusScope.of(context).unfocus();

    final dto = RegisterDto(
      email: _emailController.text.trim(),
      password: _passwordController.text,
      nickname: _nicknameController.text.trim(),
      gender: _gender,
      birthDate: AuthValidators.toWireDate(_birthDate!),
      country: _country!,
      locale: _locale,
      acceptedTerms: true,
    );

    await ref.read(authControllerProvider.notifier).register(dto);
    // On success the router guard redirects automatically.
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;
    final auth = ref.watch(authStateProvider);

    return AuthShell(
      tagline: 'Пара шагов — и вы в эфире',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          GlassCard(
            padding: const EdgeInsets.all(AppSpacing.xl),
            glowColor: colors.neonMagenta,
            glowStrength: 0.35,
            child: Form(
              key: _formKey,
              autovalidateMode: _submitted
                  ? AutovalidateMode.onUserInteraction
                  : AutovalidateMode.disabled,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('Создать аккаунт', style: context.texts.titleLarge),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    'Заполните профиль, чтобы начать знакомиться',
                    style: context.texts.bodyMedium
                        ?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // Email
                  TextFormField(
                    controller: _emailController,
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.email],
                    textInputAction: TextInputAction.next,
                    decoration: const InputDecoration(
                      labelText: 'Email',
                      prefixIcon: Icon(Icons.alternate_email_rounded),
                    ),
                    validator: AuthValidators.email,
                    onChanged: (_) => _clearError(),
                  ),
                  const SizedBox(height: AppSpacing.md),

                  // Nickname
                  TextFormField(
                    controller: _nicknameController,
                    autofillHints: const [AutofillHints.newUsername],
                    textInputAction: TextInputAction.next,
                    inputFormatters: [nicknameFormatter],
                    decoration: const InputDecoration(
                      labelText: 'Никнейм',
                      helperText: '3–24 символа: латиница, цифры и _',
                      prefixIcon: Icon(Icons.person_outline_rounded),
                    ),
                    validator: AuthValidators.nickname,
                    onChanged: (_) => _clearError(),
                  ),
                  const SizedBox(height: AppSpacing.md),

                  // Password (+ strength meter)
                  PasswordField(
                    controller: _passwordController,
                    label: 'Пароль',
                    hint: 'Минимум 8 символов',
                    showStrength: true,
                    autofillHints: const [AutofillHints.newPassword],
                    textInputAction: TextInputAction.next,
                    validator: AuthValidators.newPassword,
                    onChanged: (_) => _clearError(),
                  ),
                  const SizedBox(height: AppSpacing.lg),

                  // Gender
                  _FieldLabel('Пол'),
                  const SizedBox(height: AppSpacing.sm),
                  SegmentedChoice<Gender>(
                    options: kGenderChoices,
                    value: _gender,
                    onChanged: (g) => setState(() => _gender = g),
                  ),
                  const SizedBox(height: AppSpacing.lg),

                  // Birth date (18+)
                  BirthDateField(
                    value: _birthDate,
                    lastDate: AuthValidators.maxBirthDate(),
                    errorText: _birthDateError,
                    onChanged: (d) {
                      _clearError();
                      setState(() => _birthDate = d);
                    },
                  ),
                  const SizedBox(height: AppSpacing.md),

                  // Country
                  CountryPickerField(
                    value: _country,
                    errorText: _countryError,
                    onChanged: (c) {
                      _clearError();
                      setState(() => _country = c);
                    },
                  ),
                  const SizedBox(height: AppSpacing.lg),

                  // Interface language
                  _FieldLabel('Язык интерфейса'),
                  const SizedBox(height: AppSpacing.sm),
                  SegmentedChoice<Locale>(
                    options: kLocaleChoices,
                    value: _locale,
                    onChanged: (l) => setState(() => _locale = l),
                  ),
                  const SizedBox(height: AppSpacing.lg),

                  // Consent (acceptedTerms)
                  _ConsentTile(
                    value: _acceptedTerms,
                    onChanged: (v) => setState(() => _acceptedTerms = v),
                  ),

                  if (auth.errorMessage != null) ...[
                    const SizedBox(height: AppSpacing.md),
                    AuthErrorBanner(message: auth.errorMessage!),
                  ],
                  const SizedBox(height: AppSpacing.xl),
                  GradientButton(
                    label: 'Создать аккаунт',
                    loading: auth.isBusy,
                    onPressed: _acceptedTerms ? _submit : null,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                'Уже есть аккаунт?',
                style: context.texts.bodyMedium
                    ?.copyWith(color: scheme.onSurfaceVariant),
              ),
              TextButton(
                onPressed:
                    auth.isBusy ? null : () => context.go(AppRoutes.login),
                child: const Text('Войти'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// A small uppercase-ish field label for the segmented sections.
class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: context.texts.labelMedium
          ?.copyWith(color: context.scheme.onSurfaceVariant),
    );
  }
}

/// The Terms/Privacy consent row. Maps to `acceptedTerms` — registration is
/// blocked until it's checked (the API rejects otherwise).
class _ConsentTile extends StatelessWidget {
  const _ConsentTile({required this.value, required this.onChanged});

  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;
    return InkWell(
      borderRadius: AppRadii.brMd,
      onTap: () => onChanged(!value),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Checkbox(
              value: value,
              onChanged: (v) => onChanged(v ?? false),
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
              visualDensity: VisualDensity.compact,
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(top: AppSpacing.md),
                child: Text.rich(
                  TextSpan(
                    style: context.texts.bodySmall
                        ?.copyWith(color: scheme.onSurfaceVariant),
                    children: [
                      const TextSpan(
                          text: 'Регистрируясь, я подтверждаю, что мне есть '
                              '18 лет, и принимаю '),
                      TextSpan(
                        text: 'Условия использования',
                        style: TextStyle(
                          color: context.colors.neonCyan,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const TextSpan(text: ' и '),
                      TextSpan(
                        text: 'Политику конфиденциальности',
                        style: TextStyle(
                          color: context.colors.neonCyan,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const TextSpan(text: '.'),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
