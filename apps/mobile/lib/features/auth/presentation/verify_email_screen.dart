import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/di.dart';
import '../../../core/router/routes.dart';
import '../../../core/theme/theme.dart';
import '../../../core/widgets/widgets.dart';
import '../domain/auth_email_controller.dart';
import 'widgets/auth_shell.dart';

/// `/verify-email?token=…` — confirm an email address from the emailed link.
///
/// With a token it auto-verifies on mount and shows success/expired states.
/// Without a token (reached from a "verify your email" prompt while signed in)
/// it shows a "check your inbox" state with a resend action. Mirrors the web
/// `VerifyEmailView`.
class VerifyEmailScreen extends ConsumerStatefulWidget {
  const VerifyEmailScreen({super.key, this.token});

  /// The verification token from the `token` query parameter (null when the
  /// screen is opened as a standing "please verify" prompt).
  final String? token;

  @override
  ConsumerState<VerifyEmailScreen> createState() => _VerifyEmailScreenState();
}

class _VerifyEmailScreenState extends ConsumerState<VerifyEmailScreen> {
  bool _resending = false;

  @override
  void initState() {
    super.initState();
    final token = widget.token?.trim();
    if (token != null && token.isNotEmpty) {
      // Auto-verify once the first frame is up (so the loader is visible).
      WidgetsBinding.instance.addPostFrameCallback((_) {
        ref.read(verifyEmailControllerProvider.notifier).verify(token);
      });
    }
  }

  Future<void> _resend() async {
    setState(() => _resending = true);
    final error =
        await ref.read(verifyEmailControllerProvider.notifier).resend();
    if (!mounted) return;
    setState(() => _resending = false);
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        content: Text(error ?? 'Письмо отправлено. Проверьте почту.'),
      ));
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final hasToken = (widget.token?.trim().isNotEmpty) ?? false;
    final state = ref.watch(verifyEmailControllerProvider);
    final isAuthed = ref.watch(authStateProvider).isAuthenticated;

    final Widget body;
    if (hasToken) {
      if (state.isBusy || state.phase == AuthEmailPhase.idle) {
        body = const _VerifyStatus(
          icon: Icons.mark_email_unread_outlined,
          title: 'Подтверждаем email…',
          message: 'Это займёт пару секунд.',
          showSpinner: true,
        );
      } else if (state.isSuccess) {
        body = _VerifyStatus(
          icon: Icons.verified_rounded,
          accent: colors.success,
          title: 'Email подтверждён',
          message: 'Спасибо! Теперь все функции доступны.',
          primaryLabel: isAuthed ? 'На главную' : 'Войти',
          onPrimary: () =>
              context.go(isAuthed ? AppRoutes.dashboard : AppRoutes.login),
        );
      } else {
        body = _VerifyStatus(
          icon: Icons.error_outline_rounded,
          accent: colors.warning,
          title: 'Ссылка недействительна',
          message: state.error ??
              'Ссылка для подтверждения устарела или уже использована.',
          primaryLabel: isAuthed ? 'Отправить снова' : 'Войти',
          loading: _resending,
          onPrimary: isAuthed
              ? _resend
              : () => context.go(AppRoutes.login),
        );
      }
    } else {
      // No token — a standing "please verify your inbox" prompt.
      body = _VerifyStatus(
        icon: Icons.mark_email_unread_outlined,
        title: 'Подтвердите email',
        message:
            'Мы отправили письмо со ссылкой для подтверждения. Откройте его, '
            'чтобы активировать все функции.',
        primaryLabel: isAuthed ? 'Отправить снова' : 'Войти',
        loading: _resending,
        onPrimary: isAuthed ? _resend : () => context.go(AppRoutes.login),
      );
    }

    return AuthShell(
      tagline: 'Подтвердите свой email',
      child: GlassCard(
        padding: const EdgeInsets.all(AppSpacing.xl),
        glowColor: colors.neonCyan,
        glowStrength: 0.4,
        intensity: 1.1,
        child: body,
      ),
    );
  }
}

/// A status card body: an icon chip, a title/message, and an optional primary
/// action.
class _VerifyStatus extends StatelessWidget {
  const _VerifyStatus({
    required this.icon,
    required this.title,
    required this.message,
    this.accent,
    this.showSpinner = false,
    this.primaryLabel,
    this.onPrimary,
    this.loading = false,
  });

  final IconData icon;
  final String title;
  final String message;
  final Color? accent;
  final bool showSpinner;
  final String? primaryLabel;
  final VoidCallback? onPrimary;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;
    final tint = accent ?? colors.neonCyan;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                borderRadius: AppRadii.brMd,
                color: tint.withValues(alpha: 0.12),
              ),
              child: Icon(icon, color: tint),
            ),
            if (showSpinner) ...[
              const SizedBox(width: AppSpacing.md),
              const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2.4),
              ),
            ],
          ],
        ),
        const SizedBox(height: AppSpacing.lg),
        Text(title, style: context.texts.headlineSmall),
        const SizedBox(height: AppSpacing.sm),
        Text(
          message,
          style: context.texts.bodyMedium
              ?.copyWith(color: scheme.onSurfaceVariant, height: 1.4),
        ),
        if (primaryLabel != null && onPrimary != null) ...[
          const SizedBox(height: AppSpacing.xl),
          GradientButton(
            label: primaryLabel!,
            loading: loading,
            onPressed: onPrimary,
          ),
        ],
      ],
    );
  }
}
