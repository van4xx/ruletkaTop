'use client';

/**
 * A single chat bubble. Outbound (mine) bubbles get the neon gradient and
 * delivery ticks (sending → sent → read); inbound bubbles use a glass surface.
 * Failed optimistic sends expose a retry affordance.
 */
import { memo } from 'react';
import { motion } from 'framer-motion';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Check, CheckCheck, Clock, RotateCw } from 'lucide-react';
import type { ChatRejectReason } from '@ruletka/shared-types';
import { cn } from '@/lib/cn';
import { formatClock } from '@/features/chat/lib/format';
import type { ChatMessage } from '@/features/chat/use-thread';

/** Translator shape compatible with next-intl's `useTranslations('social')`. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Map a typed rejection reason to its localised hint (under the `social` group). */
const REJECT_REASON_KEY: Record<ChatRejectReason, string> = {
  blocked: 'messageRejectedBlocked',
  privacy: 'messageRejectedPrivacy',
  not_found: 'messageRejectedNotFound',
  invalid: 'messageRejectedInvalid',
  rate_limited: 'messageRejectedRateLimited',
  error: 'messageRejectedError',
};

/**
 * Localised failure hint for a failed bubble: the typed `chat:rejected` reason
 * when present, else the generic "not sent" label.
 */
function failureLabel(message: ChatMessage, t: Translate): string {
  return message.failedReason ? t(REJECT_REASON_KEY[message.failedReason]) : t('messageNotSent');
}

function Ticks({ message }: { message: ChatMessage }) {
  const t = useTranslations('social');
  if (message.failed) {
    return (
      <AlertCircle className="h-3.5 w-3.5 text-destructive" aria-label={failureLabel(message, t)} />
    );
  }
  if (message.pending) {
    return <Clock className="h-3.5 w-3.5 opacity-70" aria-label={t('messageSending')} />;
  }
  if (message.readAt) {
    return (
      <CheckCheck
        className="h-3.5 w-3.5 text-[var(--color-neon-cyan)]"
        aria-label={t('messageRead')}
      />
    );
  }
  return <Check className="h-3.5 w-3.5 opacity-80" aria-label={t('messageSent')} />;
}

function MessageBubbleImpl({
  message,
  mine,
  showTail,
  onRetry,
}: {
  message: ChatMessage;
  mine: boolean;
  /** Whether to render the rounded "tail" corner (last in a run). */
  showTail?: boolean;
  onRetry?: (message: ChatMessage) => void;
}) {
  const t = useTranslations('social');
  const locale = useLocale();
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className={cn('flex w-full', mine ? 'justify-end' : 'justify-start')}
    >
      <div
        className={cn(
          'relative max-w-[78%] px-3.5 py-2 text-sm sm:max-w-[70%]',
          'rounded-2xl',
          mine
            ? cn(
                'bg-gradient-to-br from-[var(--color-neon-violet)] to-[var(--color-neon-magenta)] text-white shadow-[0_4px_20px_-8px_var(--color-neon-violet)]',
                showTail ? 'rounded-br-md' : 'rounded-br-2xl',
                message.failed && 'opacity-80 ring-1 ring-destructive/60',
              )
            : cn('glass-panel text-foreground', showTail ? 'rounded-bl-md' : 'rounded-bl-2xl'),
        )}
      >
        <p className="whitespace-pre-wrap break-words leading-relaxed [overflow-wrap:anywhere]">
          {message.content}
        </p>
        {mine && message.failed && (
          <p className="mt-1 flex items-center gap-1 text-[0.6875rem] font-medium text-white/90">
            <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
            {failureLabel(message, t)}
          </p>
        )}
        <div
          className={cn(
            'mt-0.5 flex items-center justify-end gap-1 text-[0.6875rem]',
            mine ? 'text-white/70' : 'text-muted-foreground',
          )}
        >
          <time dateTime={message.createdAt}>{formatClock(message.createdAt, locale)}</time>
          {mine && <Ticks message={message} />}
        </div>

        {mine && message.failed && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(message)}
            className="absolute -left-9 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-destructive/15 text-destructive transition-colors hover:bg-destructive/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
            aria-label={t('retrySend')}
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </motion.div>
  );
}

/**
 * Memoised so a re-render of the thread (e.g. a presence tick or a new sibling
 * message) doesn't re-render every existing bubble — only those whose props
 * actually changed. Bubbles are stable once delivered.
 */
export const MessageBubble = memo(MessageBubbleImpl);
