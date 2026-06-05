import 'package:flutter/material.dart';

import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../../domain/roulette_state.dart';

/// A compact in-call chat panel over the stage (peer-to-peer data channel).
/// Mirrors the web `CallChat`: a translucent liquid-glass sheet with a neon
/// header accent, a scrolling message list (gradient "mine" bubbles), and a
/// single-line composer with a gradient send button. Slides + fades up on open.
/// Shown only while connected to a peer.
class CallChat extends StatefulWidget {
  const CallChat({
    super.key,
    required this.messages,
    required this.peerName,
    required this.onSend,
    required this.onClose,
  });

  final List<ChatLine> messages;
  final String peerName;

  /// Returns true if the message was actually sent (channel open + non-blank).
  final Future<bool> Function(String text) onSend;
  final VoidCallback onClose;

  @override
  State<CallChat> createState() => _CallChatState();
}

class _CallChatState extends State<CallChat>
    with SingleTickerProviderStateMixin {
  final TextEditingController _controller = TextEditingController();
  final ScrollController _scroll = ScrollController();
  final FocusNode _focus = FocusNode();

  late final AnimationController _enter = AnimationController(
    vsync: this,
    duration: AppDurations.normal,
  )..forward();

  @override
  void didUpdateWidget(covariant CallChat oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.messages.length != oldWidget.messages.length) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToEnd());
    }
  }

  void _scrollToEnd() {
    if (_scroll.hasClients) {
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: AppDurations.fast,
        curve: Curves.easeOut,
      );
    }
  }

  Future<void> _send() async {
    final text = _controller.text;
    if (text.trim().isEmpty) return;
    final ok = await widget.onSend(text);
    if (ok) {
      _controller.clear();
      _focus.requestFocus();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _scroll.dispose();
    _focus.dispose();
    _enter.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;
    final colors = context.colors;

    final curved = CurvedAnimation(parent: _enter, curve: AppCurves.glass);
    return FadeTransition(
      opacity: curved,
      child: SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0, 0.12),
          end: Offset.zero,
        ).animate(curved),
        child: GlassCard(
          padding: const EdgeInsets.all(AppSpacing.sm),
          borderRadius: AppRadii.brXxl,
          blurSigma: AppBlur.heavy,
          intensity: 1.1,
          glowColor: colors.neonCyan,
          glowStrength: 0.25,
          child: SizedBox(
            width: 286,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Header: a neon chat glyph + title + close.
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.sm,
                    2,
                    2,
                    AppSpacing.xs,
                  ),
                  child: Row(
                    children: [
                      ShaderMask(
                        shaderCallback: (b) => LinearGradient(
                          colors: colors.brandGradient,
                        ).createShader(b),
                        child: const Icon(
                          Icons.chat_bubble_rounded,
                          size: 16,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          'Чат',
                          style: context.texts.titleSmall,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      IconButton(
                        visualDensity: VisualDensity.compact,
                        iconSize: 18,
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints.tightFor(
                          width: 32,
                          height: 32,
                        ),
                        onPressed: widget.onClose,
                        icon: const Icon(Icons.close_rounded),
                        tooltip: 'Закрыть чат',
                      ),
                    ],
                  ),
                ),
                Divider(height: 1, color: colors.glassBorder),
                ConstrainedBox(
                  constraints: const BoxConstraints(
                    maxHeight: 220,
                    minHeight: 64,
                  ),
                  child: widget.messages.isEmpty
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(AppSpacing.lg),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  Icons.forum_outlined,
                                  size: 22,
                                  color: scheme.onSurfaceVariant.withValues(
                                    alpha: 0.6,
                                  ),
                                ),
                                const SizedBox(height: AppSpacing.sm),
                                Text(
                                  'Напишите первым',
                                  style: context.texts.bodySmall?.copyWith(
                                    color: scheme.onSurfaceVariant,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        )
                      : ListView.builder(
                          controller: _scroll,
                          shrinkWrap: true,
                          padding: const EdgeInsets.symmetric(
                            vertical: AppSpacing.sm,
                          ),
                          itemCount: widget.messages.length,
                          itemBuilder: (context, i) =>
                              _Bubble(line: widget.messages[i]),
                        ),
                ),
                const SizedBox(height: AppSpacing.sm),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _controller,
                        focusNode: _focus,
                        textInputAction: TextInputAction.send,
                        onSubmitted: (_) => _send(),
                        minLines: 1,
                        maxLines: 3,
                        style: context.texts.bodyMedium,
                        decoration: InputDecoration(
                          hintText: 'Сообщение…',
                          isDense: true,
                          filled: true,
                          fillColor: colors.glassFill,
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.md,
                            vertical: 10,
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: AppRadii.brPill,
                            borderSide: BorderSide(color: colors.glassBorder),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: AppRadii.brPill,
                            borderSide: BorderSide(
                              color: colors.neonViolet.withValues(alpha: 0.7),
                              width: 1.4,
                            ),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    _SendButton(onTap: _send),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.line});

  final ChatLine line;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;
    final mine = line.fromMe;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(
          vertical: 3,
          horizontal: AppSpacing.xs,
        ),
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.sm,
        ),
        constraints: const BoxConstraints(maxWidth: 200),
        decoration: BoxDecoration(
          gradient: mine ? LinearGradient(colors: colors.ctaGradient) : null,
          color: mine
              ? null
              : scheme.surfaceContainerHighest.withValues(alpha: 0.6),
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(AppRadii.lg),
            topRight: const Radius.circular(AppRadii.lg),
            bottomLeft: Radius.circular(mine ? AppRadii.lg : 3),
            bottomRight: Radius.circular(mine ? 3 : AppRadii.lg),
          ),
          border: mine ? null : Border.all(color: colors.glassBorder),
          boxShadow: mine
              ? AppShadows.glow(colors.neonMagenta, strength: 0.22)
              : null,
        ),
        child: Text(
          line.text,
          style: context.texts.bodySmall?.copyWith(
            color: mine ? Colors.white : scheme.onSurface,
          ),
        ),
      ),
    );
  }
}

class _SendButton extends StatefulWidget {
  const _SendButton({required this.onTap});

  final VoidCallback onTap;

  @override
  State<_SendButton> createState() => _SendButtonState();
}

class _SendButtonState extends State<_SendButton> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return AnimatedScale(
      scale: _pressed ? 0.9 : 1,
      duration: AppDurations.press,
      curve: AppCurves.glass,
      child: DecoratedBox(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          boxShadow: AppShadows.glow(
            colors.neonMagenta,
            strength: _pressed ? 0.8 : 0.45,
          ),
        ),
        child: Material(
          color: Colors.transparent,
          shape: const CircleBorder(),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: widget.onTap,
            onHighlightChanged: (v) => setState(() => _pressed = v),
            customBorder: const CircleBorder(),
            child: Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: LinearGradient(colors: colors.ctaGradient),
              ),
              child: const Icon(
                Icons.send_rounded,
                size: 18,
                color: Colors.white,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
