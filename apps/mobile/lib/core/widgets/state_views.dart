import 'package:flutter/material.dart';

import '../theme/theme.dart';
import 'gradient_button.dart';

/// A centered, friendly empty-state: a glowing icon, a title, an optional
/// description and an optional primary action. Use when a list/section has no
/// content yet (no friends, no chats, empty search…).
class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    this.message,
    this.actionLabel,
    this.onAction,
    this.iconColor,
  });

  final IconData icon;
  final String title;
  final String? message;
  final String? actionLabel;
  final VoidCallback? onAction;
  final Color? iconColor;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final accent = iconColor ?? colors.neonViolet;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 96,
              height: 96,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: accent.withValues(alpha: 0.12),
                boxShadow: AppShadows.glow(accent, strength: 0.5),
              ),
              child: Icon(icon, size: 44, color: accent),
            ),
            const SizedBox(height: AppSpacing.xl),
            Text(
              title,
              textAlign: TextAlign.center,
              style: context.texts.titleLarge,
            ),
            if (message != null) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(
                message!,
                textAlign: TextAlign.center,
                style: context.texts.bodyMedium
                    ?.copyWith(color: context.scheme.onSurfaceVariant),
              ),
            ],
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: AppSpacing.xl),
              GradientButton(
                label: actionLabel!,
                onPressed: onAction,
                fullWidth: false,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// A centered error view with a retry affordance. Pair with caught
/// [ApiException]s: pass the message and a retry callback.
class ErrorView extends StatelessWidget {
  const ErrorView({
    super.key,
    this.title = 'Что-то пошло не так',
    this.message,
    this.onRetry,
    this.retryLabel = 'Повторить',
    this.icon = Icons.error_outline_rounded,
  });

  final String title;
  final String? message;
  final VoidCallback? onRetry;
  final String retryLabel;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 56, color: scheme.error),
            const SizedBox(height: AppSpacing.lg),
            Text(title, textAlign: TextAlign.center, style: context.texts.titleLarge),
            if (message != null) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(
                message!,
                textAlign: TextAlign.center,
                style: context.texts.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
              ),
            ],
            if (onRetry != null) ...[
              const SizedBox(height: AppSpacing.xl),
              OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh_rounded, size: 18),
                label: Text(retryLabel),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
