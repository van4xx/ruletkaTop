'use client';

/** Animated three-dot "typing…" bubble shown when the peer is composing. */
import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

export function TypingIndicator({ name, className }: { name?: string; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.18 }}
      className={cn('flex w-full justify-start', className)}
      aria-live="polite"
    >
      <div className="glass-panel inline-flex items-center gap-1.5 rounded-2xl rounded-bl-md px-3.5 py-3">
        <span className="sr-only">{name ? `${name} печатает` : 'Печатает'}…</span>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            aria-hidden="true"
            className="block h-2 w-2 rounded-full bg-[var(--color-neon-cyan)]"
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
            transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut', delay: i * 0.18 }}
          />
        ))}
      </div>
    </motion.div>
  );
}
