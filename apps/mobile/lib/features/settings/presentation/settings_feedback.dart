import 'package:flutter/material.dart';

import '../../../core/theme/theme.dart';

/// Small, consistent snackbar helpers for the settings sections (save success /
/// error). Kept in one place so every section gives identical feedback.

/// A success snackbar (e.g. "Настройки сохранены").
void showSettingsSaved(BuildContext context, String message) {
  final colors = context.colors;
  _show(
    context,
    icon: Icons.check_circle_rounded,
    iconColor: colors.success,
    message: message,
  );
}

/// An error snackbar surfacing an [ApiException]/failure message.
void showSettingsError(BuildContext context, String message) {
  _show(
    context,
    icon: Icons.error_outline_rounded,
    iconColor: context.scheme.error,
    message: message,
  );
}

void _show(
  BuildContext context, {
  required IconData icon,
  required Color iconColor,
  required String message,
}) {
  final messenger = ScaffoldMessenger.of(context);
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        behavior: SnackBarBehavior.floating,
        content: Row(
          children: [
            Icon(icon, size: 18, color: iconColor),
            const SizedBox(width: AppSpacing.sm),
            Expanded(child: Text(message)),
          ],
        ),
      ),
    );
}
