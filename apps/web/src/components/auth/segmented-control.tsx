'use client';

/**
 * An accessible segmented control (single-select) — a radiogroup rendered as a
 * frosted pill row with an animated aurora-tinted active indicator that slides
 * between options (framer-motion `layoutId`). Keyboard: arrows move + select,
 * Home/End jump to the ends; roving `tabIndex` keeps one stop in the tab order.
 */
import { useId, useRef } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  'aria-label': string;
  id?: string;
  disabled?: boolean;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  id,
  disabled = false,
  className,
  ...aria
}: SegmentedControlProps<T>) {
  const groupId = useId();
  const layoutId = `seg-${id ?? groupId}`;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  function focusAndSelect(index: number) {
    const next = (index + options.length) % options.length;
    const opt = options[next];
    if (!opt) return;
    onChange(opt.value);
    refs.current[next]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        focusAndSelect(activeIndex + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        focusAndSelect(activeIndex - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusAndSelect(0);
        break;
      case 'End':
        e.preventDefault();
        focusAndSelect(options.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div
      role="radiogroup"
      id={id}
      aria-label={aria['aria-label']}
      onKeyDown={onKeyDown}
      className={cn(
        'glass-panel grid gap-1 rounded-xl p-1',
        disabled && 'pointer-events-none opacity-55',
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((opt, i) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
              'transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              selected ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {selected && (
              <motion.span
                layoutId={layoutId}
                aria-hidden="true"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                className="absolute inset-0 -z-10 rounded-lg bg-gradient-to-r from-[var(--color-neon-violet)] to-[var(--color-neon-magenta)] shadow-[0_6px_20px_-8px_var(--color-neon-violet)]"
              />
            )}
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
