'use client';

/**
 * Accessible FAQ accordion for /help. Each item is a button-controlled
 * disclosure (aria-expanded / aria-controls) with a smooth height animation via
 * framer-motion. Multiple items can be open at once; clicking toggles.
 *
 * No external accordion lib — keeps to the project's "implement simply" rule.
 */
import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface FaqItem {
  q: string;
  a: ReactNode;
}

export function FaqAccordion({ items, idPrefix }: { items: FaqItem[]; idPrefix: string }) {
  const [open, setOpen] = useState<Set<number>>(new Set());

  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <ul className="space-y-3">
      {items.map((item, i) => {
        const isOpen = open.has(i);
        const panelId = `${idPrefix}-panel-${i}`;
        const btnId = `${idPrefix}-btn-${i}`;
        return (
          <li
            key={i}
            className={cn(
              'glass-panel overflow-hidden rounded-2xl transition-colors',
              isOpen && 'border-primary/30',
            )}
          >
            <h3>
              <button
                type="button"
                id={btnId}
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(i)}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
              >
                <span className="font-display text-base font-semibold tracking-tight text-foreground">
                  {item.q}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                    'bg-card/60 text-muted-foreground ring-1 ring-border/60 transition-all',
                    isOpen && 'rotate-180 bg-primary/15 text-primary ring-primary/30',
                  )}
                >
                  <ChevronDown className="h-4 w-4" />
                </span>
              </button>
            </h3>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  id={panelId}
                  role="region"
                  aria-labelledby={btnId}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className="px-5 pb-5 pt-0 text-[0.95rem] leading-7 text-muted-foreground">
                    {item.a}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </li>
        );
      })}
    </ul>
  );
}
