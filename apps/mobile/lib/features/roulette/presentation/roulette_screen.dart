import 'dart:async';

import 'package:flutter/material.dart' hide Badge;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/api/api.dart';
import '../../../core/di/di.dart';
import '../../../core/models/models.dart';
import '../../../core/router/routes.dart';
import '../../../core/theme/theme.dart';
import '../../../core/widgets/widgets.dart';
import '../domain/roulette_state.dart';
import 'roulette_controller.dart';
import 'widgets/call_action_dialogs.dart';
import 'widgets/call_chat.dart';
import 'widgets/call_controls.dart';
import 'widgets/call_overlay.dart';
import 'widgets/filters_sheet.dart';
import 'widgets/status_screens.dart';
import 'widgets/video_tile.dart';
import 'widgets/voice_visualizer.dart';

/// How long we stay in `searching` before nudging the user to relax filters.
const Duration _kLongWaitHint = Duration(seconds: 12);

/// The flagship roulette experience — one parametrized screen for both
/// [MatchType.video] and [MatchType.voice]. The Dart counterpart of the web
/// `RouletteStage`.
///
/// Drives [rouletteControllerProvider] for the given [type] and composes an
/// immersive full-screen call arena:
///   * a dark, atmospheric stage (remote full-bleed video / peer voice
///     visualizer) mounted only while connecting/connected;
///   * overlaid status screens (idle / searching / ended / error / sign-in) for
///     every other phase;
///   * the peer overlay (top-left), a draggable local self-view PiP (video) or a
///     compact self visualizer (voice), the in-call chat, a filters button, and
///     the floating control bar wiring every action back to the controller.
///
/// All session teardown lives in the controller's `onDispose`, so simply popping
/// the screen releases the camera, peer connection and socket room.
class RouletteScreen extends ConsumerStatefulWidget {
  const RouletteScreen({super.key, required this.type});

  final MatchType type;

  @override
  ConsumerState<RouletteScreen> createState() => _RouletteScreenState();
}

class _RouletteScreenState extends ConsumerState<RouletteScreen> {
  bool _longWait = false;
  Timer? _longWaitTimer;

  /// Tracks the searching "session" so the long-wait timer re-arms on each new
  /// search (status flips to searching, or a fresh match resets the room).
  String? _searchKey;

  MatchType get _type => widget.type;
  bool get _isVideo => _type == MatchType.video;

  /// Whether a blocking ban acknowledgement is already on screen (so a repeated
  /// `mod:action` doesn't stack dialogs).
  bool _banDialogOpen = false;

  RouletteController get _controller =>
      ref.read(rouletteControllerProvider(_type).notifier);

  @override
  void initState() {
    super.initState();
    // Surface server-forced moderation (warn / kick / ban) UX. The controller
    // performs the call teardown on kick/ban; we only do the messaging here
    // (mirrors the web `useModerationAction`).
    _controller.onModeration = _handleModeration;
  }

  @override
  void dispose() {
    _longWaitTimer?.cancel();
    // Drop our callback so it can't fire into a disposed State.
    if (ref.read(rouletteControllerProvider(_type).notifier).onModeration ==
        _handleModeration) {
      ref.read(rouletteControllerProvider(_type).notifier).onModeration = null;
    }
    super.dispose();
  }

  // ── Moderation UX (mirrors web useModerationAction) ──────────────────────
  void _handleModeration(ModerationActionPayload payload) {
    if (!mounted) return;
    final reason = _moderationReason(payload);
    switch (payload.action) {
      case ModerationAction.warn:
        showCallToast(context, 'Предупреждение: $reason', error: true);
        break;
      case ModerationAction.kick:
        // The controller already ended the call; explain why.
        showCallToast(context, 'Звонок завершён: $reason', error: true);
        break;
      case ModerationAction.ban:
        _showBanDialog(reason, payload.banExpiresAt);
        break;
      case ModerationAction.blur:
      case ModerationAction.none:
        // Advisory only — the local screening loop already surfaced its toast.
        break;
    }
  }

  /// Human-readable reason for a `mod:action`, falling back through the label.
  String _moderationReason(ModerationActionPayload payload) {
    final reason = payload.reason?.trim();
    if (reason != null && reason.isNotEmpty) return reason;
    return switch (payload.label) {
      ModerationLabel.nudity => 'обнажённый контент',
      ModerationLabel.sexual => 'материалы сексуального характера',
      ModerationLabel.violence => 'сцены насилия',
      ModerationLabel.minor => 'риск контента с несовершеннолетними',
      ModerationLabel.safe ||
      ModerationLabel.other ||
      null => 'нарушение правил сообщества',
    };
  }

  String _banExpiryHint(int? banExpiresAt) {
    if (banExpiresAt == null) return 'Доступ ограничен навсегда.';
    final ms = banExpiresAt * 1000 - DateTime.now().millisecondsSinceEpoch;
    if (ms <= 0) return 'Доступ ограничен навсегда.';
    final hours = (ms / 3600000).ceil();
    if (hours < 48) return 'Доступ ограничен на $hours ч.';
    final days = (hours / 24).ceil();
    return 'Доступ ограничен на $days дн.';
  }

  Future<void> _showBanDialog(String reason, int? banExpiresAt) async {
    if (_banDialogOpen) return;
    _banDialogOpen = true;
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => AlertDialog(
        icon: Icon(Icons.gpp_bad_rounded, color: Theme.of(dialogContext).colorScheme.error),
        title: const Text('Аккаунт заблокирован'),
        content: Text('$reason\n${_banExpiryHint(banExpiresAt)}'),
        actions: [
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Понятно'),
          ),
        ],
      ),
    );
    _banDialogOpen = false;
    if (!mounted) return;
    // The session is no longer valid server-side — sign out + bounce to login.
    await ref.read(authControllerProvider.notifier).logout();
    if (mounted) context.go(AppRoutes.login);
  }

  // ── Long-wait hint ─────────────────────────────────────────────────────
  /// Arm a one-shot "still searching" hint, or clear it when we leave the
  /// searching phase. Keyed off (status + roomId) so a re-queue restarts it.
  void _syncLongWait(RouletteState state) {
    final searching = state.status == RouletteStatus.searching;
    final key = searching ? 'searching:${state.roomId ?? ''}' : null;
    if (key == _searchKey) return;
    _searchKey = key;

    _longWaitTimer?.cancel();
    _longWaitTimer = null;
    if (_longWait) {
      // Defer to post-frame: we're inside build.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) setState(() => _longWait = false);
      });
    }

    if (searching) {
      _longWaitTimer = Timer(_kLongWaitHint, () {
        if (mounted) setState(() => _longWait = true);
      });
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────
  Future<void> _handleAddFriend(PeerInfo peer) async {
    try {
      await ref.read(apiClientProvider).sendFriendRequest(peer.userId);
      if (!mounted) return;
      showCallToast(context, 'Заявка отправлена ${peer.nickname}');
    } on ApiException catch (e) {
      if (!mounted) return;
      showCallToast(context, e.message, error: true);
    } catch (_) {
      if (!mounted) return;
      showCallToast(context, 'Не удалось отправить заявку', error: true);
    }
  }

  Future<void> _openFilters(MatchFilters current, bool isPremium) async {
    final next = await showFiltersSheet(
      context,
      value: current,
      isPremium: isPremium,
    );
    if (next != null) _controller.setFilters(next);
  }

  void _openGift(PeerInfo peer) {
    showGiftPicker(
      context,
      toUserId: peer.userId,
      peerName: peer.nickname,
      isPremium: peer.isPremium,
    );
  }

  void _openReport(PeerInfo peer) {
    showReportDialog(
      context,
      ref: ref,
      againstUserId: peer.userId,
      peerName: peer.nickname,
      onReported: _controller.next, // skip to the next peer after reporting
    );
  }

  void _openBlock(PeerInfo peer) {
    showBlockDialog(
      context,
      ref: ref,
      blockedUserId: peer.userId,
      peerName: peer.nickname,
      onBlocked: _controller.next, // skip to the next peer after blocking
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(rouletteControllerProvider(_type));
    final isPremium = ref.watch(currentUserProvider)?.isPremium ?? false;
    final authed = ref.watch(authStateProvider).isAuthenticated;

    // When on-device screening cuts the local feed, surface a gentle toast once
    // (mirrors the web stage's screening.onViolation toast).
    ref.listen<RouletteState>(rouletteControllerProvider(_type), (prev, next) {
      if (next.flagged && !(prev?.flagged ?? false)) {
        showCallToast(
          context,
          'Ваше видео скрыто: возможный недопустимый контент.',
          error: true,
        );
      }
    });

    _syncLongWait(state);

    final peer = state.peer;
    final hasPeer = state.hasPeer;
    final showStage = state.showStage;

    // Definitively unauthenticated, pre-session → a dedicated sign-in prompt.
    final showSignIn = !authed && state.status == RouletteStatus.idle;

    return AppScaffold(
      showAppBar: false,
      showBottomNav: false,
      currentRoute: null,
      backgroundDecoration: false,
      body: _StageBackground(
        isVideo: _isVideo,
        child: SafeArea(
          child: Stack(
            children: [
              // ── Media layer (remote): only while connecting / connected ──
              if (showStage)
                Positioned.fill(
                  child: _isVideo
                      ? VideoTile(
                          stream: state.remoteStream,
                          placeholderName: peer?.nickname,
                          placeholderAvatar: peer?.avatarUrl,
                        )
                      : (peer != null
                            ? Center(
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: AppSpacing.xl,
                                    vertical: 96,
                                  ),
                                  child: SingleChildScrollView(
                                    child: VoiceVisualizer(
                                      name: peer.nickname,
                                      avatarUrl: peer.avatarUrl,
                                      subtitle: _peerSubtitle(peer),
                                      tone: VisualizerTone.peer,
                                      active:
                                          state.status ==
                                          RouletteStatus.connected,
                                    ),
                                  ),
                                ),
                              )
                            : const SizedBox.shrink()),
                ),

              // ── Status screens for every non-stage phase ──
              if (!showStage)
                Positioned.fill(
                  child: AnimatedSwitcher(
                    duration: AppDurations.normal,
                    child: _statusScreen(state, showSignIn: showSignIn),
                  ),
                ),

              // ── Peer overlay (top-left) ──
              if (hasPeer && peer != null)
                Positioned(
                  top: AppSpacing.md,
                  left: AppSpacing.md,
                  right: AppSpacing.md,
                  child: Align(
                    alignment: Alignment.topLeft,
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 320),
                      child: CallOverlay(
                        peer: peer,
                        status: state.status,
                        compact: !_isVideo,
                        quality: state.quality,
                        reconnecting: state.reconnecting,
                      ),
                    ),
                  ),
                ),

              // ── Filters button (top-right) ──
              if (!showSignIn)
                Positioned(
                  top: AppSpacing.md,
                  right: AppSpacing.md,
                  child: _FiltersButton(
                    count: activeFilterCount(state.filters),
                    onTap: () => _openFilters(state.filters, isPremium),
                  ),
                ),

              // ── Local self view (bottom-right): PiP (video) / mini eq (voice) ──
              if (state.isActive && state.localStream != null) ...[
                if (_isVideo)
                  Positioned(
                    right: AppSpacing.md,
                    bottom: 108,
                    child: _LocalPip(
                      stream: state.localStream,
                      cameraOff: state.cameraOff,
                      flagged: state.flagged,
                    ),
                  )
                else if (showStage)
                  Positioned(
                    right: AppSpacing.md,
                    bottom: 112,
                    child: GlassCard(
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.md,
                        vertical: AppSpacing.sm,
                      ),
                      borderRadius: AppRadii.brXl,
                      blurSigma: 18,
                      child: VoiceVisualizer(
                        name: 'Вы',
                        tone: VisualizerTone.local,
                        compact: true,
                        active: !state.micMuted,
                      ),
                    ),
                  ),
              ],

              // ── In-call chat (bottom-left) ──
              if (state.chatOpen && hasPeer && peer != null)
                Positioned(
                  left: AppSpacing.md,
                  bottom: 108,
                  child: CallChat(
                    messages: state.chatMessages,
                    peerName: peer.nickname,
                    onSend: _controller.sendChatMessage,
                    onClose: () => _controller.setChatOpen(false),
                  ),
                ),

              // ── Floating control bar (bottom-center) ──
              if (!showSignIn)
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: AppSpacing.lg,
                  child: Center(
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.md,
                      ),
                      child: CallControls(
                        status: state.status,
                        isVideo: _isVideo,
                        micMuted: state.micMuted,
                        cameraOff: state.cameraOff,
                        isStarting: state.isStarting,
                        hasPeer: hasPeer,
                        chatOpen: state.chatOpen,
                        onStart: _controller.start,
                        onNext: _controller.next,
                        onStop: _controller.stop,
                        onToggleMic: _controller.toggleMic,
                        onToggleCamera: _controller.toggleCamera,
                        onSwitchCamera: _controller.switchCamera,
                        onGift: () {
                          if (peer != null) _openGift(peer);
                        },
                        onAddFriend: () {
                          if (peer != null) _handleAddFriend(peer);
                        },
                        onToggleChat: () =>
                            _controller.setChatOpen(!state.chatOpen),
                        onReport: () {
                          if (peer != null) _openReport(peer);
                        },
                        onBlock: () {
                          if (peer != null) _openBlock(peer);
                        },
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  String _peerSubtitle(PeerInfo peer) => '${peer.age} · ${peer.country}';

  Widget _statusScreen(RouletteState state, {required bool showSignIn}) {
    if (showSignIn) {
      return KeyedSubtree(
        key: const ValueKey('signin'),
        child: SignInScreen(isVideo: _isVideo),
      );
    }
    return switch (state.status) {
      RouletteStatus.idle || RouletteStatus.requesting => KeyedSubtree(
        key: const ValueKey('idle'),
        child: IdleScreen(isVideo: _isVideo),
      ),
      RouletteStatus.searching => KeyedSubtree(
        key: const ValueKey('searching'),
        child: SearchingScreen(
          positionHint: state.positionHint,
          longWait: _longWait,
        ),
      ),
      RouletteStatus.ended => const KeyedSubtree(
        key: ValueKey('ended'),
        child: EndedScreen(),
      ),
      RouletteStatus.error => KeyedSubtree(
        key: const ValueKey('error'),
        child: RouletteErrorScreen(
          error:
              state.error ??
              const RouletteError(
                kind: 'unknown',
                message: 'Что-то пошло не так.',
              ),
          onRetry: _controller.start,
        ),
      ),
      // connecting / connected are handled by the stage, never reach here.
      _ => const SizedBox.shrink(),
    };
  }
}

/// The dark, atmospheric arena both modes share: a near-black canvas lit by
/// three soft neon aurora blobs (violet top-center, cyan bottom-right, magenta
/// bottom-left) — the native twin of the web `StageFrame` backdrop. Voice mode
/// turns the ambience up a touch since there's no full-bleed video to carry it.
class _StageBackground extends StatelessWidget {
  const _StageBackground({required this.isVideo, required this.child});

  final bool isVideo;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final boost = isVideo ? 1.0 : 1.4;
    return DecoratedBox(
      decoration: const BoxDecoration(color: Color(0xFF07070B)),
      child: Stack(
        children: [
          // Violet bloom anchored above the top-center (the dominant glow).
          Positioned.fill(
            child: IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: RadialGradient(
                    center: const Alignment(0, -1.05),
                    radius: 1.25,
                    colors: [
                      colors.neonViolet.withValues(
                        alpha: (isVideo ? 0.16 : 0.24),
                      ),
                      const Color(0xFF07070B),
                    ],
                    stops: const [0, 0.62],
                  ),
                ),
              ),
            ),
          ),
          // Cyan accent, lower-right.
          Positioned(
            right: -120,
            bottom: -90,
            child: IgnorePointer(
              child: _Blob(
                color: colors.neonCyan,
                size: 320,
                strength: 0.16 * boost,
              ),
            ),
          ),
          // Magenta counterweight, lower-left.
          Positioned(
            left: -130,
            bottom: -110,
            child: IgnorePointer(
              child: _Blob(
                color: colors.neonMagenta,
                size: 300,
                strength: 0.13 * boost,
              ),
            ),
          ),
          child,
        ],
      ),
    );
  }
}

/// A soft circular neon bloob (radial fill that fades to transparent) for the
/// stage ambience.
class _Blob extends StatelessWidget {
  const _Blob({
    required this.color,
    required this.size,
    required this.strength,
  });

  final Color color;
  final double size;
  final double strength;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: RadialGradient(
          colors: [
            color.withValues(alpha: strength.clamp(0.0, 1.0)),
            color.withValues(alpha: 0),
          ],
          stops: const [0.0, 1.0],
        ),
      ),
    );
  }
}

/// A draggable picture-in-picture self-view for video mode, with a "Вы" tag.
class _LocalPip extends StatefulWidget {
  const _LocalPip({
    required this.stream,
    required this.cameraOff,
    this.flagged = false,
  });

  final MediaStream? stream;
  final bool cameraOff;
  final bool flagged;

  @override
  State<_LocalPip> createState() => _LocalPipState();
}

class _LocalPipState extends State<_LocalPip> {
  Offset _drag = Offset.zero;
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Transform.translate(
      offset: _drag,
      child: GestureDetector(
        onPanUpdate: (d) => setState(() => _drag += d.delta),
        onPanEnd: (_) => setState(() => _pressed = false),
        onPanDown: (_) => setState(() => _pressed = true),
        child: AnimatedScale(
          scale: _pressed ? 1.03 : 1,
          duration: AppDurations.fast,
          curve: AppCurves.glass,
          child: Container(
            width: 112,
            height: 156,
            decoration: BoxDecoration(
              borderRadius: AppRadii.brXl,
              boxShadow: [
                ...AppShadows.glass(strength: 0.9),
                if (_pressed)
                  ...AppShadows.glow(colors.neonViolet, strength: 0.6),
              ],
            ),
            child: Stack(
              fit: StackFit.expand,
              children: [
                // The tile body, clipped, with a neon-tinted gradient ring.
                ClipRRect(
                  borderRadius: AppRadii.brXl,
                  child: VideoTile(
                    stream: widget.stream,
                    mirror: true,
                    cameraOff: widget.cameraOff,
                    flagged: widget.flagged,
                    placeholderName: 'Вы',
                  ),
                ),
                // Gradient hairline ring (a Container border can't take a
                // gradient, so we stroke a rounded rect with a shader instead).
                Positioned.fill(
                  child: IgnorePointer(
                    child: CustomPaint(
                      painter: _GradientRingPainter(
                        borderRadius: AppRadii.brXl,
                        colors: [
                          colors.neonViolet.withValues(alpha: 0.85),
                          colors.neonCyan.withValues(alpha: 0.55),
                        ],
                      ),
                    ),
                  ),
                ),
                Positioned(
                  left: 6,
                  bottom: 6,
                  child: GlassCard(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 3,
                    ),
                    borderRadius: AppRadii.brSm,
                    blurSigma: AppBlur.subtle,
                    child: Text(
                      'Вы',
                      style: context.texts.labelSmall?.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w700,
                      ),
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

/// Strokes a rounded-rect frame with a linear gradient — used for the self-view
/// PiP's neon ring (Flutter's [Border] can't carry a gradient).
class _GradientRingPainter extends CustomPainter {
  const _GradientRingPainter({
    required this.borderRadius,
    required this.colors,
  });

  final BorderRadius borderRadius;
  final List<Color> colors;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final rrect = borderRadius.toRRect(rect).deflate(0.75);
    final paint = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: colors,
      ).createShader(rect)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;
    canvas.drawRRect(rrect, paint);
  }

  @override
  bool shouldRepaint(_GradientRingPainter old) =>
      old.colors != colors || old.borderRadius != borderRadius;
}

/// The glassy filters trigger pill, with an active-filter count badge. Lights up
/// with a violet glow when filters are active, and presses in tactilely.
class _FiltersButton extends StatefulWidget {
  const _FiltersButton({required this.count, required this.onTap});

  final int count;
  final VoidCallback onTap;

  @override
  State<_FiltersButton> createState() => _FiltersButtonState();
}

class _FiltersButtonState extends State<_FiltersButton> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;
    final active = widget.count > 0;
    return AnimatedScale(
      scale: _pressed ? 0.92 : 1,
      duration: AppDurations.press,
      curve: AppCurves.glass,
      child: Material(
        color: Colors.transparent,
        shape: const CircleBorder(),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: widget.onTap,
          onHighlightChanged: (v) => setState(() => _pressed = v),
          customBorder: const CircleBorder(),
          splashColor: colors.neonViolet.withValues(alpha: 0.16),
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              GlassCard(
                padding: EdgeInsets.zero,
                borderRadius: AppRadii.brPill,
                blurSigma: AppBlur.glass,
                glowColor: active || _pressed ? colors.neonViolet : null,
                glowStrength: _pressed ? 0.7 : 0.4,
                child: SizedBox(
                  width: 48,
                  height: 48,
                  child: Icon(
                    Icons.tune_rounded,
                    size: 22,
                    color: active ? colors.neonViolet : scheme.onSurface,
                  ),
                ),
              ),
              if (widget.count > 0)
                Positioned(
                  top: -2,
                  right: -2,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(colors: colors.ctaGradient),
                      borderRadius: AppRadii.brPill,
                      border: Border.all(
                        color: const Color(0xFF07070B),
                        width: 2,
                      ),
                    ),
                    child: Text(
                      '${widget.count}',
                      style: context.texts.labelSmall?.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                        height: 1,
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
