import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/models.dart';
import '../../../core/router/router.dart';
import '../../../core/theme/theme.dart';
import '../../../core/widgets/widgets.dart';
import '../../chat/data/chat_repository.dart';
import '../application/pending_direct_call.dart';
import '../domain/direct_call_controller.dart';

/// The GLOBAL direct-call host — the native twin of the web `ModalHost`'s
/// incoming-call surface. Mounted ONCE over the routed app (see `main.dart`),
/// it keeps [directCallControllerProvider] alive (so its `call:*` listeners on
/// the always-alive `/mm` socket are wired whenever the app is running), renders
/// the incoming/outgoing ring sheet, navigates to the call stage when a call is
/// accepted, and surfaces a toast when a call is declined.
///
/// The controller only reacts to events that arrive while the socket is
/// connected (post-auth), so this host is inert when signed out.
class DirectCallHost extends ConsumerStatefulWidget {
  const DirectCallHost({super.key});

  @override
  ConsumerState<DirectCallHost> createState() => _DirectCallHostState();
}

class _DirectCallHostState extends ConsumerState<DirectCallHost> {
  @override
  Widget build(BuildContext context) {
    // Keep the controller (and its socket listeners) alive for the whole app.
    final state = ref.watch(directCallControllerProvider);

    // One-shot: navigate to the call stage when a call is accepted.
    ref.listen<DirectCallState>(directCallControllerProvider, (prev, next) {
      final launch = next.launch;
      if (launch != null && launch != prev?.launch) {
        ref.read(directCallControllerProvider.notifier).consumeLaunch();
        _openStage(launch);
      }
      final toast = next.toast;
      if (toast != null && toast != prev?.toast) {
        ref.read(directCallControllerProvider.notifier).consumeToast();
        _showToast(toast);
      }
    });

    final ring = state.ring;
    if (ring == null) return const SizedBox.shrink();

    // A dimmed, full-screen ring sheet over the app (must be answered).
    return Positioned.fill(
      child: ColoredBox(
        color: Colors.black.withValues(alpha: 0.62),
        child: SafeArea(
          child: Center(
            child: _RingSheet(
              ring: ring,
              onAccept: () =>
                  ref.read(directCallControllerProvider.notifier).accept(),
              onDecline: () =>
                  ref.read(directCallControllerProvider.notifier).decline(),
            ),
          ),
        ),
      ),
    );
  }

  /// Hand the accepted call off to the roulette engine. We record the launch in
  /// the one-shot [pendingDirectCallProvider] BEFORE navigating, then route to
  /// the matching stage; the freshly-mounted `RouletteScreen` drains it in
  /// `initState` and invokes `startDirectCall`, so the call connects to the
  /// friend over the `call:<callId>` room instead of dropping into the random
  /// matchmaking queue (a bare `router.go` lost the call context entirely).
  void _openStage(DirectCallLaunch launch) {
    ref.read(pendingDirectCallProvider.notifier).set(launch);
    final router = ref.read(routerProvider);
    router.go(launch.type == MatchType.video ? AppRoutes.video : AppRoutes.voice);
  }

  void _showToast(String message) {
    final messenger = ScaffoldMessenger.maybeOf(context);
    messenger
      ?..clearSnackBars()
      ..showSnackBar(SnackBar(content: Text(message)));
  }
}

/// The ring card: caller avatar + name, modality chip and the accept/decline
/// affordances. Mirrors the web `CallInviteModal` look (pulsing avatar, video /
/// voice chip, red decline + green accept).
class _RingSheet extends ConsumerWidget {
  const _RingSheet({
    required this.ring,
    required this.onAccept,
    required this.onDecline,
  });

  final DirectCallRing ring;
  final VoidCallback onAccept;
  final VoidCallback onDecline;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = context.colors;
    final isVideo = ring.type == MatchType.video;
    // Look the peer up for a richer card (best-effort; falls back to a name).
    final peer = ref.watch(peerProfileProvider(ring.peerUserId)).value;
    final name = (peer?.nickname.isNotEmpty ?? false)
        ? peer!.nickname
        : 'Собеседник';

    final subtitle = ring.isIncoming
        ? (isVideo ? 'Входящий видеозвонок' : 'Входящий аудиозвонок')
        : (isVideo ? 'Видеозвонок…' : 'Аудиозвонок…');

    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 360),
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: GlassCard(
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg, vertical: AppSpacing.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Modality chip.
              Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.md, vertical: 5),
                decoration: BoxDecoration(
                  color: colors.glassFill,
                  borderRadius: AppRadii.brPill,
                  border: Border.all(color: colors.glassBorder),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(isVideo ? Icons.videocam_rounded : Icons.mic_rounded,
                        size: 15, color: context.scheme.onSurfaceVariant),
                    const SizedBox(width: 6),
                    Text(
                      isVideo ? 'Видео' : 'Аудио',
                      style: context.texts.labelSmall?.copyWith(
                        color: context.scheme.onSurfaceVariant,
                        letterSpacing: 0.4,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.lg),
              NeonAvatar(
                imageUrl: peer?.avatarUrl,
                name: peer?.nickname,
                size: 96,
                glow: true,
              ),
              const SizedBox(height: AppSpacing.md),
              Text(
                name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: context.texts.titleLarge?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: context.texts.bodyMedium
                    ?.copyWith(color: context.scheme.onSurfaceVariant),
              ),
              const SizedBox(height: AppSpacing.xl),
              Row(
                mainAxisAlignment: ring.isIncoming
                    ? MainAxisAlignment.spaceEvenly
                    : MainAxisAlignment.center,
                children: [
                  _CallButton(
                    icon: Icons.call_end_rounded,
                    label: ring.isIncoming ? 'Отклонить' : 'Отменить',
                    color: context.scheme.error,
                    onTap: onDecline,
                  ),
                  // Only the callee can answer; the caller just waits/cancels.
                  if (ring.isIncoming)
                    _CallButton(
                      icon: Icons.call_rounded,
                      label: 'Ответить',
                      color: colors.success,
                      onTap: onAccept,
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A round call affordance (decline = red, accept = green) with a caption.
class _CallButton extends StatelessWidget {
  const _CallButton({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Material(
          color: color,
          shape: const CircleBorder(),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            child: SizedBox(
              width: 60,
              height: 60,
              child: Icon(icon, color: Colors.white, size: 26),
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        Text(
          label,
          style: context.texts.labelMedium
              ?.copyWith(color: context.scheme.onSurfaceVariant),
        ),
      ],
    );
  }
}
