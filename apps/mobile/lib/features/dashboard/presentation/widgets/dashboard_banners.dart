import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/di/di.dart';
import '../../../../core/models/models.dart';
import '../../../../core/status/public_status_provider.dart';
import '../../../../core/theme/theme.dart';
import '../../../auth/domain/auth_email_controller.dart';

/// ─────────────────────────────────────────────────────────────────────────
/// Dashboard client-completeness banners.
///
/// Two slim, non-blocking notices surfaced at the top of the hub, mirroring the
/// web chrome:
///   • [MaintenanceBanner]  — shown when `GET /public/status` reports
///     `maintenanceMode === true` ("идут технические работы…"). Informational,
///     not dismissible (it reflects a live server flag — it clears itself when
///     maintenance ends + the status refreshes on resume).
///   • [VerifyEmailBanner]  — shown when the signed-in user's
///     `emailVerified === false`, with a "Отправить ещё раз" resend action.
///     DISMISSIBLE for the session only (mirrors the web's sessionStorage
///     dismissal — it returns on a fresh app launch until the email is
///     verified). Mirrors the web `verify-email-banner.tsx`.
///
/// Both render nothing (zero layout) when their condition isn't met.
/// ─────────────────────────────────────────────────────────────────────────

/// A non-blocking "maintenance in progress" notice, driven by
/// [publicStatusProvider]. Renders nothing unless `maintenanceMode` is true.
class MaintenanceBanner extends ConsumerWidget {
  const MaintenanceBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // `.value` so a loading / errored status simply shows nothing (the provider
    // already degrades errors to the open default).
    final status = ref.watch(publicStatusProvider).value;
    if (status == null || !status.maintenanceMode) {
      return const SizedBox.shrink();
    }
    return _DashboardNotice(
      icon: Icons.build_circle_outlined,
      accent: context.colors.warning,
      body: Text(
        'Идут технические работы — часть функций временно недоступна.',
        style: context.texts.bodySmall?.copyWith(
          color: context.scheme.onSurface,
          fontWeight: FontWeight.w600,
          height: 1.35,
        ),
      ),
    );
  }
}

/// A dismissible "please confirm your email" notice with a resend action.
/// Shown only when the signed-in user's `emailVerified` is explicitly `false`
/// (an `null`/unknown value — older sessions — never nags). Dismissal is
/// IN-MEMORY for the session, so it returns on a fresh launch until verified.
class VerifyEmailBanner extends ConsumerStatefulWidget {
  const VerifyEmailBanner({super.key});

  @override
  ConsumerState<VerifyEmailBanner> createState() => _VerifyEmailBannerState();
}

class _VerifyEmailBannerState extends ConsumerState<VerifyEmailBanner> {
  bool _dismissed = false;
  bool _resending = false;

  Future<void> _resend() async {
    if (_resending) return;
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
    final AuthUser? user = ref.watch(currentUserProvider);
    // Only nag on an explicit `false` (mirrors the web): `null`/unknown means
    // an older session that predates the field, so we stay quiet.
    final needsVerification = user?.emailVerified == false;
    if (!needsVerification || _dismissed) return const SizedBox.shrink();

    final colors = context.colors;
    return _DashboardNotice(
      icon: Icons.mark_email_unread_outlined,
      accent: colors.neonViolet,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Подтвердите ваш email',
            style: context.texts.bodySmall?.copyWith(
              color: context.scheme.onSurface,
              fontWeight: FontWeight.w700,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            'Откройте письмо со ссылкой, чтобы активировать все функции.',
            style: context.texts.bodySmall?.copyWith(
              color: context.scheme.onSurfaceVariant,
              height: 1.35,
            ),
          ),
        ],
      ),
      trailing: _ResendButton(loading: _resending, onPressed: _resend),
      onDismiss: () => setState(() => _dismissed = true),
    );
  }
}

/// The verify banner's "Отправить ещё раз" action — a compact pill that shows a
/// spinner while the resend request is in flight.
class _ResendButton extends StatelessWidget {
  const _ResendButton({required this.loading, required this.onPressed});

  final bool loading;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return TextButton.icon(
      onPressed: loading ? null : onPressed,
      style: TextButton.styleFrom(
        foregroundColor: colors.neonViolet,
        visualDensity: VisualDensity.compact,
        padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.sm, vertical: AppSpacing.xs),
      ),
      icon: loading
          ? const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.send_rounded, size: 14),
      label: Text(
        loading ? 'Отправляем…' : 'Отправить ещё раз',
        style: context.texts.labelMedium?.copyWith(
          color: colors.neonViolet,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

/// Shared chrome for the dashboard notices: a slim glassy bar tinted by
/// [accent], with a leading icon, the [body], an optional [trailing] action and
/// (when [onDismiss] is given) a close affordance.
class _DashboardNotice extends StatelessWidget {
  const _DashboardNotice({
    required this.icon,
    required this.accent,
    required this.body,
    this.trailing,
    this.onDismiss,
  });

  final IconData icon;
  final Color accent;
  final Widget body;
  final Widget? trailing;
  final VoidCallback? onDismiss;

  @override
  Widget build(BuildContext context) {
    return Padding(
      // Sits inside the dashboard's horizontally-padded ListView, so add only
      // vertical breathing room below the bar.
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: TweenAnimationBuilder<double>(
        tween: Tween(begin: 0, end: 1),
        duration: AppDurations.normal,
        curve: AppCurves.glass,
        builder: (context, t, child) => Opacity(
          opacity: t.clamp(0.0, 1.0),
          child: Transform.translate(
              offset: Offset(0, (1 - t) * -6), child: child),
        ),
        child: Container(
          padding: const EdgeInsets.fromLTRB(
              AppSpacing.md, AppSpacing.sm, AppSpacing.sm, AppSpacing.sm),
          decoration: BoxDecoration(
            color: accent.withValues(alpha: 0.12),
            borderRadius: AppRadii.brMd,
            border: Border.all(color: accent.withValues(alpha: 0.4)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Icon(icon, size: 18, color: accent),
              const SizedBox(width: AppSpacing.sm),
              Expanded(child: body),
              if (trailing != null) ...[
                const SizedBox(width: AppSpacing.xs),
                trailing!,
              ],
              if (onDismiss != null)
                IconButton(
                  onPressed: onDismiss,
                  iconSize: 16,
                  visualDensity: VisualDensity.compact,
                  padding: EdgeInsets.zero,
                  constraints:
                      const BoxConstraints(minWidth: 32, minHeight: 32),
                  color: context.scheme.onSurfaceVariant,
                  icon: const Icon(Icons.close_rounded),
                  tooltip: 'Скрыть',
                ),
            ],
          ),
        ),
      ),
    );
  }
}
