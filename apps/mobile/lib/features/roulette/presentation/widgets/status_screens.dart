import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/router/routes.dart';
import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../../data/media_permissions.dart';
import '../../domain/roulette_state.dart';

/// Shared centered shell for every non-connected roulette state.
class _Shell extends StatelessWidget {
  const _Shell({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 360),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: children,
          ),
        ),
      ),
    );
  }
}

/// Idle pre-flight hero (before the first Start).
class IdleScreen extends StatelessWidget {
  const IdleScreen({super.key, required this.isVideo});

  final bool isVideo;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return _Shell(
      children: [
        Container(
          width: 88,
          height: 88,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: colors.neonViolet.withValues(alpha: 0.12),
            boxShadow: AppShadows.glow(colors.neonViolet, strength: 0.7),
          ),
          child: Icon(Icons.auto_awesome_rounded, size: 40, color: colors.neonCyan),
        ),
        const SizedBox(height: AppSpacing.xl),
        Text(
          isVideo ? 'Видеорулетка' : 'Голосовая рулетка',
          textAlign: TextAlign.center,
          style: AppTypography.display(fontSize: 26, color: context.scheme.onSurface),
        ),
        const SizedBox(height: AppSpacing.sm),
        Text(
          isVideo
              ? 'Нажмите «Начать» — мы попросим доступ к камере и микрофону и найдём собеседника.'
              : 'Нажмите «Начать» — мы попросим доступ к микрофону и найдём собеседника.',
          textAlign: TextAlign.center,
          style: context.texts.bodyMedium?.copyWith(color: context.scheme.onSurfaceVariant),
        ),
      ],
    );
  }
}

/// Searching / waiting radar with concentric pulses.
class SearchingScreen extends StatefulWidget {
  const SearchingScreen({super.key, this.positionHint, this.longWait = false});

  final int? positionHint;
  final bool longWait;

  @override
  State<SearchingScreen> createState() => _SearchingScreenState();
}

class _SearchingScreenState extends State<SearchingScreen> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2200),
  )..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final hint = widget.positionHint;
    final subtitle = widget.longWait
        ? 'Пока тихо в эфире. Попробуйте смягчить фильтры — найдём быстрее.'
        : (hint != null && hint > 0)
            ? 'Вы в очереди: позиция $hint'
            : 'Это займёт пару секунд.';

    return _Shell(
      children: [
        SizedBox(
          width: 112,
          height: 112,
          child: AnimatedBuilder(
            animation: _c,
            builder: (context, child) {
              return Stack(
                alignment: Alignment.center,
                children: [
                  _pulse(colors.neonViolet, _c.value),
                  _pulse(colors.neonCyan, (_c.value + 0.4) % 1.0),
                  child!,
                ],
              );
            },
            child: Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: colors.glassFill,
                border: Border.all(color: colors.glassBorder),
              ),
              child: Icon(Icons.radar_rounded, size: 28, color: colors.neonCyan),
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.xl),
        Text(
          'Ищем собеседника…',
          textAlign: TextAlign.center,
          style: AppTypography.display(fontSize: 20, color: context.scheme.onSurface),
        ),
        const SizedBox(height: AppSpacing.sm),
        Text(
          subtitle,
          textAlign: TextAlign.center,
          style: context.texts.bodyMedium?.copyWith(color: context.scheme.onSurfaceVariant),
        ),
      ],
    );
  }

  Widget _pulse(Color color, double t) {
    final size = 56 + t * 56;
    return Opacity(
      opacity: (1 - t) * 0.5,
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(color: color.withValues(alpha: 0.5)),
        ),
      ),
    );
  }
}

/// Brief interstitial when a peer leaves before auto-requeue.
class EndedScreen extends StatelessWidget {
  const EndedScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return _Shell(
      children: [
        SizedBox(
          width: 40,
          height: 40,
          child: CircularProgressIndicator(
            strokeWidth: 3,
            valueColor: AlwaysStoppedAnimation(colors.neonMagenta),
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        Text(
          'Собеседник отключился',
          textAlign: TextAlign.center,
          style: AppTypography.display(fontSize: 18, color: context.scheme.onSurface),
        ),
        const SizedBox(height: AppSpacing.xs),
        Text(
          'Ищем следующего…',
          textAlign: TextAlign.center,
          style: context.texts.bodyMedium?.copyWith(color: context.scheme.onSurfaceVariant),
        ),
      ],
    );
  }
}

/// Recoverable error (permission / device / network / auth).
class RouletteErrorScreen extends StatelessWidget {
  const RouletteErrorScreen({super.key, required this.error, required this.onRetry});

  final RouletteError error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final (icon, title) = switch (error.kind) {
      'denied' || 'permanentlyDenied' => (Icons.mic_off_rounded, 'Нет доступа к устройствам'),
      'notfound' => (Icons.videocam_off_rounded, 'Устройство не найдено'),
      'inuse' => (Icons.warning_amber_rounded, 'Устройство занято'),
      'insecure' => (Icons.warning_amber_rounded, 'Устройство недоступно'),
      'socket' || 'timeout' => (Icons.wifi_off_rounded, 'Нет соединения'),
      'auth' => (Icons.login_rounded, 'Войдите, чтобы начать'),
      _ => (Icons.error_outline_rounded, 'Что-то пошло не так'),
    };
    final isAuth = error.kind == 'auth';
    final isPermanent = error.kind == 'permanentlyDenied';

    return _Shell(
      children: [
        Container(
          width: 64,
          height: 64,
          decoration: BoxDecoration(
            borderRadius: AppRadii.brXl,
            color: context.scheme.error.withValues(alpha: 0.14),
          ),
          child: Icon(icon, size: 32, color: context.scheme.error),
        ),
        const SizedBox(height: AppSpacing.lg),
        Text(
          title,
          textAlign: TextAlign.center,
          style: AppTypography.display(fontSize: 20, color: context.scheme.onSurface),
        ),
        const SizedBox(height: AppSpacing.sm),
        Text(
          error.message,
          textAlign: TextAlign.center,
          style: context.texts.bodyMedium?.copyWith(color: context.scheme.onSurfaceVariant),
        ),
        const SizedBox(height: AppSpacing.xl),
        if (isAuth)
          GradientButton(
            label: 'Войти',
            icon: Icons.login_rounded,
            fullWidth: false,
            onPressed: () => context.go(AppRoutes.login),
          )
        else if (isPermanent)
          GradientButton(
            label: 'Открыть настройки',
            icon: Icons.settings_rounded,
            fullWidth: false,
            onPressed: () => MediaPermissions.openSettings(),
          )
        else
          GradientButton(
            label: 'Попробовать снова',
            fullWidth: false,
            onPressed: onRetry,
          ),
      ],
    );
  }
}

/// Shown when there is definitively no session (unauthenticated).
class SignInScreen extends StatelessWidget {
  const SignInScreen({super.key, required this.isVideo});

  final bool isVideo;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return _Shell(
      children: [
        Container(
          width: 64,
          height: 64,
          decoration: BoxDecoration(
            borderRadius: AppRadii.brXl,
            color: colors.neonViolet.withValues(alpha: 0.14),
          ),
          child: Icon(Icons.login_rounded, size: 32, color: colors.neonViolet),
        ),
        const SizedBox(height: AppSpacing.lg),
        Text(
          'Войдите, чтобы начать',
          textAlign: TextAlign.center,
          style: AppTypography.display(fontSize: 20, color: context.scheme.onSurface),
        ),
        const SizedBox(height: AppSpacing.sm),
        Text(
          '${isVideo ? 'Видеорулетка' : 'Голосовая рулетка'} доступна авторизованным пользователям. Это займёт минуту.',
          textAlign: TextAlign.center,
          style: context.texts.bodyMedium?.copyWith(color: context.scheme.onSurfaceVariant),
        ),
        const SizedBox(height: AppSpacing.xl),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            GradientButton(
              label: 'Войти',
              fullWidth: false,
              onPressed: () => context.go(AppRoutes.login),
            ),
            const SizedBox(width: AppSpacing.md),
            OutlinedButton(
              onPressed: () => context.go(AppRoutes.register),
              child: const Text('Регистрация'),
            ),
          ],
        ),
      ],
    );
  }
}
