'use client';

/**
 * Ephemeral in-call text chat. Messages travel peer-to-peer over a WebRTC data
 * channel (no server round-trip, no persistence) — so it works without any
 * extra socket events. Slides in from the side on desktop, bottom sheet on
 * mobile.
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Send, X } from 'lucide-react';
import { IconButton, Input } from '@ruletka/ui';
import type { ChatLine } from '@/features/roulette/types';
import { cn } from '@/lib/cn';

export interface CallChatProps {
  open: boolean;
  onClose: () => void;
  messages: ChatLine[];
  onSend: (text: string) => boolean;
  peerName: string;
}

export function CallChat({ open, onClose, messages, onSend, peerName }: CallChatProps) {
  const t = useTranslations('roulette');
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest message.
  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (onSend(draft)) setDraft('');
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="call-chat"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className={cn(
            'glass-panel pointer-events-auto flex flex-col overflow-hidden rounded-2xl',
            'h-[min(70vh,28rem)] w-full sm:w-80',
          )}
          aria-label={t('chat.ariaLabel', { name: peerName })}
        >
          <header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <span className="font-display text-sm font-bold">{t('chat.title')}</span>
            <IconButton aria-label={t('chat.close')} variant="ghost" size="sm" onClick={onClose}>
              <X />
            </IconButton>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {messages.length === 0 ? (
              <p className="mt-6 text-center text-xs text-muted-foreground">
                {t('chat.empty')}
              </p>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={cn('flex', m.from === 'me' ? 'justify-end' : 'justify-start')}
                >
                  <span
                    className={cn(
                      'max-w-[80%] rounded-2xl px-3 py-1.5 text-sm',
                      m.from === 'me'
                        ? 'bg-aurora text-accent-foreground'
                        : 'bg-card/70 text-foreground',
                    )}
                  >
                    {m.text}
                  </span>
                </div>
              ))
            )}
          </div>

          <form onSubmit={submit} className="flex items-center gap-2 border-t border-border/60 p-3">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('chat.placeholder')}
              maxLength={500}
              aria-label={t('chat.messageAriaLabel')}
              className="h-10"
            />
            <IconButton
              type="submit"
              aria-label={t('chat.send')}
              variant="primary"
              size="md"
              disabled={!draft.trim()}
            >
              <Send />
            </IconButton>
          </form>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
