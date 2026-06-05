import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/di.dart';
import '../../../core/router/routes.dart';
import '../../../core/theme/theme.dart';
import '../../../core/widgets/widgets.dart';
import '../domain/auth_validators.dart';
import 'widgets/auth_form_fields.dart';
import 'widgets/auth_shell.dart';

/// The login screen — the app's unauthenticated entry point and the screen the
/// router lands on when there's no session.
///
/// Mirrors `loginSchema` (email + non-empty password). On success the auth
/// controller persists the access token (memory) + refresh token (secure
/// storage) and connects the socket; the router guard then redirects to
/// `/dashboard` automatically when the auth status flips.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    FocusScope.of(context).unfocus();
    await ref
        .read(authControllerProvider.notifier)
        .login(_emailController.text, _passwordController.text);
    // On success the router guard redirects automatically (auth status flips).
  }

  void _clearError() => ref.read(authControllerProvider.notifier).clearError();

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;
    final auth = ref.watch(authStateProvider);

    return AuthShell(
      tagline: 'С возвращением в эфир',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          GlassCard(
            padding: const EdgeInsets.all(AppSpacing.xl),
            glowColor: colors.neonViolet,
            glowStrength: 0.45,
            intensity: 1.1,
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Eyebrow + display heading — the brand's high-impact lockup.
                  Text(
                    'ВХОД',
                    style: AppTypography.eyebrow(color: colors.neonCyan),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    'С возвращением',
                    style: context.texts.headlineSmall,
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    'Войди, чтобы продолжить общение в эфире.',
                    style: context.texts.bodyMedium
                        ?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                  const SizedBox(height: AppSpacing.xl),

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

                  PasswordField(
                    controller: _passwordController,
                    autofillHints: const [AutofillHints.password],
                    textInputAction: TextInputAction.done,
                    validator: AuthValidators.loginPassword,
                    onChanged: (_) => _clearError(),
                    onSubmitted: _submit,
                  ),

                  if (auth.errorMessage != null) ...[
                    const SizedBox(height: AppSpacing.md),
                    AuthErrorBanner(message: auth.errorMessage!),
                  ],

                  const SizedBox(height: AppSpacing.xl),
                  GradientButton(
                    label: 'Войти',
                    icon: Icons.login_rounded,
                    loading: auth.isBusy,
                    onPressed: _submit,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          _SwitchAuthRow(
            prompt: 'Нет аккаунта?',
            actionLabel: 'Создать',
            onPressed:
                auth.isBusy ? null : () => context.push(AppRoutes.register),
          ),
        ],
      ),
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
