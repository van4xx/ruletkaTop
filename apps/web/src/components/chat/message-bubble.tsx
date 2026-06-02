'use client';

/**
 * A single chat bubble. Outbound (mine) bubbles get the neon gradient and
 * delivery ticks (sending → sent → read); inbound bubbles use a glass surface.
 * Failed optimistic sends expose a retry affordance.
 */
import { motion } from 'framer-motion';
import { AlertCircle, Check, CheckCheck, Clock, RotateCw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatClock } from '@/features/chat/lib/format';
import type { ChatMessage } from '@/features/chat/use-thread';

function Ticks({ message }: { message: ChatMessage }) {
  if (message.failed) {
    return <AlertCircle className="h-3.5 w-3.5 text-destructive" aria-label="Не отправлено" />;
  }
  if (message.pending) {
    return <Clock className="h-3.5 w-3.5 opacity-70" aria-label="Отправляется" />;
  }
  if (message.readAt) {
    return <CheckCheck className="h-3.5 w-3.5 text-[var(--color-neon-cyan)]" aria-label="Прочитано" />;
  }
  return <Check className="h-3.5 w-3.5 opacity-80" aria-label="Отправлено" />;
}

export function MessageBubble({
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
                'bg-gradient-to-br from-[var(--color-neon-violet)] to-[oklch(0.62_0.26_320)] text-white shadow-[0_4px_20px_-8px_var(--color-neon-violet)]',
                showTail ? 'rounded-br-md' : 'rounded-br-2xl',
                message.failed && 'opacity-80 ring-1 ring-destructive/60',
              )
            : cn(
                'glass-panel text-foreground',
                showTail ? 'rounded-bl-md' : 'rounded-bl-2xl',
              ),
        )}
      >
        <p className="whitespace-pre-wrap break-words leading-relaxed [overflow-wrap:anywhere]">
          {message.content}
        </p>
        <div
          className={cn(
            'mt-0.5 flex items-center justify-end gap-1 text-[0.6875rem]',
            mine ? 'text-white/70' : 'text-muted-foreground',
          )}
        >
          <time dateTime={message.createdAt}>{formatClock(message.createdAt)}</time>
          {mine && <Ticks message={message} />}
        </div>

        {mine && message.failed && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(message)}
            className="absolute -left-9 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-destructive/15 text-destructive transition-colors hover:bg-destructive/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
            aria-label="Повторить отправку"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </motion.div>
  );
}
