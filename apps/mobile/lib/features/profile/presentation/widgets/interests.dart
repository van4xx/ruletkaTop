import 'package:flutter/material.dart';

import '../../../../core/theme/theme.dart';

/// Curated interest catalogue — the Dart mirror of the web onboarding's
/// `INTERESTS` (`apps/web/src/components/onboarding/interests.ts`). Each option
/// carries a stable [key] (the exact tag string persisted to the profile, so
/// mobile and web produce identical tags), a Russian [label] and an [emoji].
///
/// Stored interests are plain strings: a curated [key] like `music`, or any
/// custom free-text tag the user typed. Display helpers below resolve a stored
/// tag back to its label/emoji, falling back to the raw string for custom tags.
class InterestOption {
  const InterestOption(this.key, this.label, this.emoji);

  final String key;
  final String label;
  final String emoji;
}

/// Keep in lock-step with the web catalogue so a curated pick is the same tag
/// on both platforms.
const List<InterestOption> kInterestCatalogue = [
  InterestOption('music', 'Музыка', '🎧'),
  InterestOption('travel', 'Путешествия', '✈️'),
  InterestOption('games', 'Игры', '🎮'),
  InterestOption('movies', 'Кино и сериалы', '🎬'),
  InterestOption('sport', 'Спорт', '⚽'),
  InterestOption('art', 'Искусство', '🎨'),
  InterestOption('tech', 'Технологии', '💻'),
  InterestOption('food', 'Еда', '🍜'),
  InterestOption('books', 'Книги', '📚'),
  InterestOption('languages', 'Языки', '🗣️'),
  InterestOption('photo', 'Фотография', '📷'),
  InterestOption('nature', 'Природа', '🌿'),
  InterestOption('fashion', 'Мода', '👗'),
  InterestOption('science', 'Наука', '🔬'),
  InterestOption('pets', 'Питомцы', '🐾'),
  InterestOption('dance', 'Танцы', '💃'),
];

/// The max number of interest tags a profile may carry (mirrors the contract's
/// `z.array(...).max(10)`).
const int kMaxInterests = 10;

/// The max length of a single interest tag (mirrors `z.string().max(24)`).
const int kMaxInterestLength = 24;

final Map<String, InterestOption> _byKey = {
  for (final o in kInterestCatalogue) o.key: o,
};

/// Human label for a stored tag — the curated label, or the tag itself.
String interestLabel(String tag) => _byKey[tag]?.label ?? tag;

/// Emoji for a stored tag, or null for custom tags.
String? interestEmoji(String tag) => _byKey[tag]?.emoji;

/// A read-only wrap of interest chips for the profile screens. Renders nothing
/// when [interests] is empty (backward-compatible with pre-interests profiles).
/// When [highlight] is supplied, tags in that set are accented (used to spotlight
/// interests shared with the viewer — not wired by default).
class InterestChips extends StatelessWidget {
  const InterestChips({
    super.key,
    required this.interests,
    this.highlight = const {},
  });

  final List<String> interests;
  final Set<String> highlight;

  @override
  Widget build(BuildContext context) {
    if (interests.isEmpty) return const SizedBox.shrink();
    return Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      children: [
        for (final tag in interests)
          _InterestChip(
            label: interestLabel(tag),
            emoji: interestEmoji(tag),
            accent: highlight.contains(tag),
          ),
      ],
    );
  }
}

class _InterestChip extends StatelessWidget {
  const _InterestChip({required this.label, this.emoji, this.accent = false});

  final String label;
  final String? emoji;
  final bool accent;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final fg = accent ? colors.neonMagenta : context.scheme.onSurface;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: 7),
      decoration: BoxDecoration(
        borderRadius: AppRadii.brPill,
        color: accent
            ? colors.neonMagenta.withValues(alpha: 0.14)
            : context.scheme.surfaceContainerHighest.withValues(alpha: 0.5),
        border: Border.all(
          color: accent
              ? colors.neonMagenta.withValues(alpha: 0.45)
              : colors.glassBorder,
        ),
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
            style: context.texts.labelMedium?.copyWith(color: fg),
          ),
        ],
      ),
    );
  }
}
