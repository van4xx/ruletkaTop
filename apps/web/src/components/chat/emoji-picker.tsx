'use client';

/**
 * A lightweight, dependency-free emoji picker. A curated, categorised set of
 * native unicode emoji (no images, no new deps) in a click-outside popover with
 * tab navigation. Inserts the chosen emoji via `onSelect`.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'framer-motion';
import { Smile } from 'lucide-react';
import { IconButton } from '@ruletka/ui';
import { cn } from '@/lib/cn';

const CATEGORIES: { id: string; labelKey: string; emojis: string[] }[] = [
  {
    id: 'smileys',
    labelKey: 'emojiCategorySmileys',
    emojis: [
      '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😜', '🤪', '😎',
      '🥳', '🤩', '😏', '😌', '🙃', '😉', '😇', '🤗', '🤔', '🤨',
      '😐', '😴', '😪', '😋', '😛', '🤤', '😢', '😭', '😤', '😱',
      '😳', '🥺', '😬', '🙄', '😮', '😲', '🤯', '😵', '🤧', '🥶',
    ],
  },
  {
    id: 'gestures',
    labelKey: 'emojiCategoryGestures',
    emojis: [
      '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '👏', '🙌', '🙏',
      '🤝', '💪', '👋', '🤙', '✊', '👊', '🫶', '👀', '🫡', '🤌',
    ],
  },
  {
    id: 'hearts',
    labelKey: 'emojiCategoryHearts',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💖', '💗',
      '💓', '💞', '💕', '💘', '💝', '❣️', '💔', '❤️‍🔥', '💟', '♥️',
    ],
  },
  {
    id: 'fun',
    labelKey: 'emojiCategoryFun',
    emojis: [
      '🔥', '✨', '🎉', '🎊', '💯', '⭐', '🌟', '💫', '🥂', '🍾',
      '🎁', '🌹', '🌈', '☀️', '⚡', '💥', '🎶', '🚀', '👑', '💎',
    ],
  },
];

export function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const t = useTranslations('social');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(CATEGORIES[0]!.id);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const activeCat = CATEGORIES.find((c) => c.id === active) ?? CATEGORIES[0]!;

  return (
    <div ref={rootRef} className="relative">
      <IconButton
        type="button"
        variant="ghost"
        size="md"
        aria-label={t('emoji')}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(open && 'text-[var(--color-neon-cyan)]')}
      >
        <Smile aria-hidden="true" />
      </IconButton>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="glass-panel absolute bottom-12 left-0 z-50 w-72 origin-bottom-left overflow-hidden rounded-2xl shadow-xl"
            role="dialog"
            aria-label={t('emojiPicker')}
          >
            {/* Category tabs */}
            <div className="flex items-center gap-1 border-b border-border/60 p-1.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActive(c.id)}
                  className={cn(
                    'flex-1 rounded-lg px-2 py-1.5 text-lg leading-none transition-colors',
                    c.id === active ? 'bg-card/80' : 'hover:bg-card/50',
                  )}
                  aria-pressed={c.id === active}
                  aria-label={t(c.labelKey)}
                  title={t(c.labelKey)}
                >
                  {c.emojis[0]}
                </button>
              ))}
            </div>

            {/* Emoji grid */}
            <div className="grid max-h-48 grid-cols-7 gap-0.5 overflow-y-auto p-2">
              {activeCat.emojis.map((emoji, i) => (
                <button
                  key={`${emoji}-${i}`}
                  type="button"
                  onClick={() => {
                    onSelect(emoji);
                    // Keep open for multi-insert; common UX for chat pickers.
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-xl transition-transform hover:scale-125 hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t('emojiAria', { emoji })}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
