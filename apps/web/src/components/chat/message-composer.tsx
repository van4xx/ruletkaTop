'use client';

/**
 * The message composer: an auto-growing textarea with an emoji picker and a
 * send button. Enter sends, Shift+Enter inserts a newline. Emits a typing
 * signal as the user writes. Caps content at the contract's 4000-char limit.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SendHorizontal } from 'lucide-react';
import { IconButton } from '@ruletka/ui';
import { cn } from '@/lib/cn';
import { EmojiPicker } from './emoji-picker';

const MAX_LEN = 4000;

export function MessageComposer({
  onSend,
  onTyping,
  disabled,
}: {
  onSend: (content: string) => void;
  onTyping?: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations('social');
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea up to a max height.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const canSend = value.trim().length > 0 && !disabled;

  function submit() {
    if (!canSend) return;
    onSend(value);
    setValue('');
    // Reset height after clearing.
    requestAnimationFrame(() => {
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      textareaRef.current?.focus();
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function insertEmoji(emoji: string) {
    const el = textareaRef.current;
    if (!el) {
      setValue((v) => (v + emoji).slice(0, MAX_LEN));
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = (value.slice(0, start) + emoji + value.slice(end)).slice(0, MAX_LEN);
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = Math.min(start + emoji.length, MAX_LEN);
      el.setSelectionRange(caret, caret);
    });
  }

  return (
    <div className="glass-panel flex items-end gap-1.5 rounded-2xl p-1.5">
      <EmojiPicker onSelect={insertEmoji} />

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value.slice(0, MAX_LEN));
          onTyping?.();
        }}
        onKeyDown={handleKeyDown}
        rows={1}
        disabled={disabled}
        placeholder={t('messagePlaceholder')}
        aria-label={t('messageInputLabel')}
        className={cn(
          'flex-1 resize-none bg-transparent px-2 py-2.5 text-sm text-foreground outline-none',
          'placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60',
          'max-h-40 leading-relaxed',
        )}
      />

      <IconButton
        type="button"
        variant={canSend ? 'primary' : 'ghost'}
        size="md"
        aria-label={t('send')}
        disabled={!canSend}
        onClick={submit}
        className={cn('shrink-0 transition-all', canSend && 'scale-100', !canSend && 'opacity-60')}
      >
        <SendHorizontal aria-hidden="true" />
      </IconButton>
    </div>
  );
}
