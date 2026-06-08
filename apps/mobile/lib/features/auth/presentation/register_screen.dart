import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/api/api_config.dart';
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
      tagline: 'Присоединяйся к эфиру',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          GlassCard(
            padding: const EdgeInsets.all(AppSpacing.xl),
            glowColor: colors.neonMagenta,
            glowStrength: 0.4,
            intensity: 1.1,
            child: Form(
              key: _formKey,
              autovalidateMode: _submitted
                  ? AutovalidateMode.onUserInteraction
                  : AutovalidateMode.disabled,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Eyebrow + display heading.
                  Text(
                    'РЕГИСТРАЦИЯ',
                    style: AppTypography.eyebrow(color: colors.neonMagenta),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    'Создать аккаунт',
                    style: context.texts.headlineSmall,
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    'Пара шагов — и ты в эфире.',
                    style: context.texts.bodyMedium
                        ?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                  const SizedBox(height: AppSpacing.xl),

                  // Email
                  AuthTextField(
                    controller: _emailController,
                    label: 'Email',
                    hint: 'you@example.com',
                    prefixIcon: Icons.alternate_email_rounded,
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.email],
                    textInputAction: TextInputAction.next,
                    validator: AuthValidators.email,
                    onChanged: (_) => _clearError(),
                  ),
                  const SizedBox(height: AppSpacing.md),

                  // Nickname
                  AuthTextField(
                    controller: _nicknameController,
                    label: 'Никнейм',
                    hint: 'cosmic_fox',
                    helperText: '3–24 символа: латиница, цифры и _',
                    prefixIcon: Icons.person_outline_rounded,
                    autofillHints: const [AutofillHints.newUsername],
                    textInputAction: TextInputAction.next,
                    inputFormatters: [nicknameFormatter],
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
                  const _FieldLabel('Пол'),
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
                  const _FieldLabel('Язык интерфейса'),
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
                    icon: Icons.auto_awesome_rounded,
                    gradientColors: [colors.neonViolet, colors.neonMagenta],
                    loading: auth.isBusy,
                    onPressed: _acceptedTerms ? _submit : null,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Text(
                    'Регистрируясь, ты подтверждаешь, что тебе есть 18 лет.',
                    textAlign: TextAlign.center,
                    style: context.texts.bodySmall
                        ?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          _SwitchAuthRow(
            prompt: 'Уже есть аккаунт?',
            actionLabel: 'Войти',
            onPressed: auth.isBusy ? null : () => context.go(AppRoutes.login),
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

/// The "switch to the other auth screen" row — a muted prompt with a neon-cyan
/// text action, centered under the card.
class _SwitchAuthRow extends StatelessWidget {
  const _SwitchAuthRow({
    required this.prompt,
    required this.actionLabel,
    required this.onPressed,
  });

  final String prompt;
  final String actionLabel;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Text(
          prompt,
          style: context.texts.bodyMedium
              ?.copyWith(color: context.scheme.onSurfaceVariant),
        ),
        TextButton(
          onPressed: onPressed,
          style: TextButton.styleFrom(foregroundColor: colors.neonCyan),
          child: Text(
            actionLabel,
            style: context.texts.labelLarge?.copyWith(
              color: colors.neonCyan,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    );
  }
}

/// The Terms/Privacy consent row. Maps to `acceptedTerms` — registration is
/// blocked until it's checked (the API rejects otherwise). Rendered as a frosted
/// glass tile that lights up its border when accepted. The "Условия
/// использования" + "Политику конфиденциальности" labels are TAPPABLE and open
/// the website's legal pages in the browser (the row's own tap still toggles the
/// checkbox).
class _ConsentTile extends StatefulWidget {
  const _ConsentTile({required this.value, required this.onChanged});

  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  State<_ConsentTile> createState() => _ConsentTileState();
}

class _ConsentTileState extends State<_ConsentTile> {
  late final TapGestureRecognizer _termsTap;
  late final TapGestureRecognizer _privacyTap;

  @override
  void initState() {
    super.initState();
    _termsTap = TapGestureRecognizer()
      ..onTap = () => _openLegal(ApiConfig.termsUrl);
    _privacyTap = TapGestureRecognizer()
      ..onTap = () => _openLegal(ApiConfig.privacyUrl);
  }

  @override
  void dispose() {
    _termsTap.dispose();
    _privacyTap.dispose();
    super.dispose();
  }

  Future<void> _openLegal(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(content: Text('Не удалось открыть ссылку')),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;
    final colors = context.colors;
    final value = widget.value;
    final linkStyle = TextStyle(
      color: colors.neonCyan,
      fontWeight: FontWeight.w600,
      decoration: TextDecoration.underline,
      decorationColor: colors.neonCyan.withValues(alpha: 0.5),
    );

    return AnimatedContainer(
      duration: AppDurations.normal,
      curve: AppCurves.glass,
      decoration: BoxDecoration(
        color: colors.glassFill.withValues(alpha: value ? 0.6 : 0.35),
        borderRadius: AppRadii.brMd,
        border: Border.all(
          color: value
              ? colors.neonCyan.withValues(alpha: 0.5)
              : colors.glassBorder,
        ),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: AppRadii.brMd,
          onTap: () => widget.onChanged(!value),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md,
              vertical: AppSpacing.sm,
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Checkbox(
                  value: value,
                  onChanged: (v) => widget.onChanged(v ?? false),
                  materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  visualDensity: VisualDensity.compact,
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text.rich(
                    TextSpan(
                      style: context.texts.bodySmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                        height: 1.4,
                      ),
                      children: [
                        const TextSpan(text: 'Я принимаю '),
                        TextSpan(
                          text: 'Условия использования',
                          style: linkStyle,
                          recognizer: _termsTap,
                        ),
                        const TextSpan(text: ' и '),
                        TextSpan(
                          text: 'Политику конфиденциальности',
                          style: linkStyle,
                          recognizer: _privacyTap,
                        ),
                        const TextSpan(text: '.'),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
