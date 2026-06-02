import 'package:flutter/material.dart';

import '../../../../core/theme/theme.dart';
import '../../../../core/widgets/widgets.dart';
import '../../domain/roulette_state.dart';

/// A compact in-call chat panel over the stage (peer-to-peer data channel).
/// Mirrors the web `CallChat`: a glass card with a scrolling message list and a
/// single-line composer. Shown only while connected to a peer.
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

class _CallChatState extends State<CallChat> {
  final TextEditingController _controller = TextEditingController();
  final ScrollController _scroll = ScrollController();
  final FocusNode _focus = FocusNode();

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
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = context.scheme;
    return GlassCard(
      padding: const EdgeInsets.all(AppSpacing.sm),
      borderRadius: AppRadii.brXl,
      blurSigma: 24,
      child: SizedBox(
        width: 280,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const SizedBox(width: AppSpacing.xs),
                Icon(Icons.chat_bubble_rounded, size: 16, color: context.colors.neonCyan),
                const SizedBox(width: 6),
                Expanded(
                  child: Text('Чат', style: context.texts.titleSmall, overflow: TextOverflow.ellipsis),
                ),
                IconButton(
                  visualDensity: VisualDensity.compact,
                  iconSize: 18,
                  onPressed: widget.onClose,
                  icon: const Icon(Icons.close_rounded),
                  tooltip: 'Закрыть чат',
                ),
              ],
            ),
            const Divider(height: 1),
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 220, minHeight: 60),
              child: widget.messages.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(AppSpacing.lg),
                        child: Text(
                          'Напишите первым',
                          style: context.texts.bodySmall
                              ?.copyWith(color: scheme.onSurfaceVariant),
                        ),
                      ),
                    )
                  : ListView.builder(
                      controller: _scroll,
                      shrinkWrap: true,
                      padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
                      itemCount: widget.messages.length,
                      itemBuilder: (context, i) => _Bubble(line: widget.messages[i]),
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
                    decoration: const InputDecoration(
                      hintText: 'Сообщение…',
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 10),
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
        margin: const EdgeInsets.symmetric(vertical: 3, horizontal: AppSpacing.xs),
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
        constraints: const BoxConstraints(maxWidth: 200),
        decoration: BoxDecoration(
          gradient: mine ? LinearGradient(colors: colors.ctaGradient) : null,
          color: mine ? null : scheme.surfaceContainerHighest.withValues(alpha: 0.6),
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(AppRadii.md),
            topRight: const Radius.circular(AppRadii.md),
            bottomLeft: Radius.circular(mine ? AppRadii.md : 2),
            bottomRight: Radius.circular(mine ? 2 : AppRadii.md),
          ),
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

class _SendButton extends StatelessWidget {
  const _SendButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Material(
      color: Colors.transparent,
      shape: const CircleBorder(),
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: LinearGradient(colors: colors.ctaGradient),
          ),
          child: const Icon(Icons.send_rounded, size: 18, color: Colors.white),
        ),
      ),
    );
  }
}
