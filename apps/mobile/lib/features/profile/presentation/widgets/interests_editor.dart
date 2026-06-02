import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../core/theme/theme.dart';
import 'interests.dart';

/// The interests editor embedded in the profile edit form.
///
/// Surfaces the currently selected tags as removable neon chips, a free-text
/// field to add custom tags (Enter / the add button commits the trimmed,
/// ≤[kMaxInterestLength]-char value), and a wrap of curated suggestions from
/// [kInterestCatalogue] that toggle on/off. The whole editor caps the selection
/// at [kMaxInterests] and dedupes case-insensitively, mirroring the contract
/// (`z.array(z.string().min(1).max(24)).max(10)`).
///
/// Stateless w.r.t. ownership: it never mutates in place — every change calls
/// [onChanged] with a fresh list so the parent form owns the source of truth.
class InterestsEditor extends StatefulWidget {
  const InterestsEditor({
    super.key,
    required this.selected,
    required this.onChanged,
  });

  final List<String> selected;
  final ValueChanged<List<String>> onChanged;

  @override
  State<InterestsEditor> createState() => _InterestsEditorState();
}

class _InterestsEditorState extends State<InterestsEditor> {
  final _controller = TextEditingController();
  final _focus = FocusNode();

  @override
  void dispose() {
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  bool get _atCap => widget.selected.length >= kMaxInterests;

  bool _has(String tag) =>
      widget.selected.any((t) => t.toLowerCase() == tag.toLowerCase());

  void _add(String raw) {
    final tag = raw.trim();
    if (tag.isEmpty) return;
    final clipped =
        tag.length > kMaxInterestLength ? tag.substring(0, kMaxInterestLength) : tag;
    if (_has(clipped) || _atCap) {
      _controller.clear();
      return;
    }
    widget.onChanged([...widget.selected, clipped]);
    _controller.clear();
    // Keep focus so several tags can be typed in a row.
    _focus.requestFocus();
  }

  void _remove(String tag) {
    widget.onChanged(
      widget.selected.where((t) => t != tag).toList(growable: false),
    );
  }

  void _toggleCurated(InterestOption opt) {
    if (_has(opt.key)) {
      _remove(widget.selected.firstWhere(
        (t) => t.toLowerCase() == opt.key.toLowerCase(),
        orElse: () => opt.key,
      ));
    } else {
      _add(opt.key);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Selected tags (removable). Shown only when there are any.
        if (widget.selected.isNotEmpty) ...[
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: [
              for (final tag in widget.selected)
                _SelectedChip(
                  label: interestLabel(tag),
                  emoji: interestEmoji(tag),
                  onRemove: () => _remove(tag),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
        ],

        // Free-text add field (disabled at the cap).
        TextField(
          controller: _controller,
          focusNode: _focus,
          enabled: !_atCap,
          maxLength: kMaxInterestLength,
          textInputAction: TextInputAction.done,
          textCapitalization: TextCapitalization.sentences,
          inputFormatters: [LengthLimitingTextInputFormatter(kMaxInterestLength)],
          onSubmitted: _add,
          decoration: InputDecoration(
            counterText: '',
            labelText: _atCap ? 'Достигнут лимит интересов' : 'Свой интерес',
            hintText: 'Например, кулинария',
            prefixIcon: const Icon(Icons.tag_rounded),
            suffixIcon: IconButton(
              tooltip: 'Добавить',
              icon: const Icon(Icons.add_circle_rounded),
              color: colors.neonMagenta,
              onPressed: _atCap ? null : () => _add(_controller.text),
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.xs),
        Text(
          'Выбрано ${widget.selected.length} из $kMaxInterests',
          style: context.texts.labelSmall
              ?.copyWith(color: scheme.onSurfaceVariant),
        ),
        const SizedBox(height: AppSpacing.md),

        // Curated suggestions.
        Text(
          'Популярное',
          style: context.texts.labelMedium?.copyWith(
            color: scheme.onSurfaceVariant,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.sm,
          children: [
            for (final opt in kInterestCatalogue)
              _SuggestionChip(
                option: opt,
                selected: _has(opt.key),
                // Disable unselected suggestions once at the cap.
                enabled: _has(opt.key) || !_atCap,
                onTap: () => _toggleCurated(opt),
              ),
          ],
        ),
      ],
    );
  }
}

/// A selected interest as a removable neon pill (× clears it).
class _SelectedChip extends StatelessWidget {
  const _SelectedChip({
    required this.label,
    required this.onRemove,
    this.emoji,
  });

  final String label;
  final String? emoji;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      padding: const EdgeInsets.fromLTRB(AppSpacing.md, 6, 6, 6),
      decoration: BoxDecoration(
        borderRadius: AppRadii.brPill,
        color: colors.neonMagenta.withValues(alpha: 0.16),
        border: Border.all(color: colors.neonMagenta.withValues(alpha: 0.5)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (emoji != null) ...[
            Text(emoji!, style: const TextStyle(fontSize: 13)),
            const SizedBox(width: 6),
          ],
          Text(
            label,
            style: context.texts.labelMedium
                ?.copyWith(color: context.scheme.onSurface),
          ),
          const SizedBox(width: 2),
          InkWell(
            onTap: onRemove,
            customBorder: const CircleBorder(),
            child: Padding(
              padding: const EdgeInsets.all(2),
              child: Icon(Icons.close_rounded,
                  size: 15, color: colors.neonMagenta),
            ),
          ),
        ],
      ),
    );
  }
}

/// A curated suggestion chip (toggles selection); dims when disabled at the cap.
class _SuggestionChip extends StatelessWidget {
  const _SuggestionChip({
    required this.option,
    required this.selected,
    required this.enabled,
    required this.onTap,
  });

  final InterestOption option;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final scheme = context.scheme;

    return Opacity(
      opacity: enabled ? 1 : 0.4,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: enabled ? onTap : null,
          borderRadius: AppRadii.brPill,
          child: Container(
            padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.md, vertical: AppSpacing.sm),
            decoration: BoxDecoration(
              borderRadius: AppRadii.brPill,
              color: selected
                  ? colors.neonMagenta.withValues(alpha: 0.16)
                  : scheme.surfaceContainerHighest.withValues(alpha: 0.4),
              border: Border.all(
                color: selected
                    ? colors.neonMagenta.withValues(alpha: 0.6)
                    : colors.glassBorder,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(option.emoji, style: const TextStyle(fontSize: 13)),
                const SizedBox(width: 6),
                Text(
                  option.label,
                  style: context.texts.labelMedium?.copyWith(
                    color: selected ? scheme.onSurface : scheme.onSurfaceVariant,
                    fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                  ),
                ),
                if (selected) ...[
                  const SizedBox(width: 4),
                  Icon(Icons.check_rounded, size: 14, color: colors.neonMagenta),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
