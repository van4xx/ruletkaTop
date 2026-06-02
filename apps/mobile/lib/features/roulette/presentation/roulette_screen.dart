import 'dart:async';

import 'package:flutter/material.dart' hide Badge;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../../../core/api/api.dart';
import '../../../core/di/di.dart';
import '../../../core/models/models.dart';
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

  RouletteController get _controller =>
      ref.read(rouletteControllerProvider(_type).notifier);

  @override
  void dispose() {
    _longWaitTimer?.cancel();
    super.dispose();
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
    final next = await showFiltersSheet(context, value: current, isPremium: isPremium);
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
                                    horizontal: AppSpacing.xl, vertical: 96),
                                child: SingleChildScrollView(
                                  child: VoiceVisualizer(
                                    name: peer.nickname,
                                    avatarUrl: peer.avatarUrl,
                                    subtitle: _peerSubtitle(peer),
                                    tone: VisualizerTone.peer,
                                    active: state.status == RouletteStatus.connected,
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
                    ),
                  )
                else if (showStage)
                  Positioned(
                    right: AppSpacing.md,
                    bottom: 112,
                    child: GlassCard(
                      padding: const EdgeInsets.symmetric(
                          horizontal: AppSpacing.md, vertical: AppSpacing.sm),
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
                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
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
            error: state.error ??
                const RouletteError(kind: 'unknown', message: 'Что-то пошло не так.'),
            onRetry: _controller.start,
          ),
        ),
      // connecting / connected are handled by the stage, never reach here.
      _ => const SizedBox.shrink(),
    };
  }
}

/// The dark, atmospheric arena both modes share: a near-black canvas with a
/// faint top-center violet glow (mirrors the web `StageFrame` backdrop).
class _StageBackground extends StatelessWidget {
  const _StageBackground({required this.isVideo, required this.child});

  final bool isVideo;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return DecoratedBox(
      decoration: const BoxDecoration(color: Color(0xFF07070B)),
      child: Stack(
        children: [
          // Soft neon ambience for the idle/voice areas.
          Positioned.fill(
            child: IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: RadialGradient(
                    center: const Alignment(0, -1.05),
                    radius: 1.25,
                    colors: [
                      colors.neonViolet.withValues(alpha: isVideo ? 0.14 : 0.20),
                      const Color(0xFF07070B),
                    ],
                    stops: const [0, 0.62],
                  ),
                ),
              ),
            ),
          ),
          Positioned(
            right: -80,
            bottom: -60,
            child: IgnorePointer(
              child: Container(
                width: 280,
                height: 280,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  boxShadow: AppShadows.glow(colors.neonCyan, strength: 0.5),
                ),
              ),
            ),
          ),
          child,
        ],
      ),
    );
  }
}

/// A draggable picture-in-picture self-view for video mode, with a "Вы" tag.
class _LocalPip extends StatefulWidget {
  const _LocalPip({required this.stream, required this.cameraOff});

  final MediaStream? stream;
  final bool cameraOff;

  @override
  State<_LocalPip> createState() => _LocalPipState();
}

class _LocalPipState extends State<_LocalPip> {
  Offset _drag = Offset.zero;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Transform.translate(
      offset: _drag,
      child: GestureDetector(
        onPanUpdate: (d) => setState(() => _drag += d.delta),
        child: Container(
          width: 112,
          height: 156,
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            borderRadius: AppRadii.brXl,
            border: Border.all(color: colors.glassBorder),
            boxShadow: AppShadows.card,
          ),
          child: Stack(
            fit: StackFit.expand,
            children: [
              VideoTile(
                stream: widget.stream,
                mirror: true,
                cameraOff: widget.cameraOff,
                placeholderName: 'Вы',
              ),
              Positioned(
                left: 6,
                bottom: 6,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.5),
                    borderRadius: AppRadii.brSm,
                  ),
                  child: Text(
                    'Вы',
                    style: context.texts.labelSmall?.copyWith(
                      color: Colors.white,
                      fontWeight: FontWeight.w600,
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

/// The glassy filters trigger pill, with an active-filter count badge.
class _FiltersButton extends StatelessWidget {
  const _FiltersButton({required this.count, required this.onTap});

  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;
    return Material(
      color: Colors.transparent,
      shape: const CircleBorder(),
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            GlassCard(
              padding: EdgeInsets.zero,
              borderRadius: AppRadii.brPill,
              blurSigma: 18,
              child: SizedBox(
                width: 48,
                height: 48,
                child: Icon(Icons.tune_rounded, size: 22, color: scheme.onSurface),
              ),
            ),
            if (count > 0)
              Positioned(
                top: -2,
                right: -2,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(colors: colors.ctaGradient),
                    borderRadius: AppRadii.brPill,
                    border: Border.all(color: const Color(0xFF07070B), width: 2),
                  ),
                  child: Text(
                    '$count',
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
    );
  }
}
