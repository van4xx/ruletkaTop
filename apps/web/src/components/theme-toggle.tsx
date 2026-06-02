'use client';

/**
 * Theme toggle that cycles the active color scheme.
 *
 * Uses next-themes' `useTheme`. Because the resolved theme is only known on the
 * client, we render a stable, non-interactive placeholder until mounted to
 * avoid a hydration mismatch and icon flash.
 */
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/cn';

const ORDER = ['light', 'dark', 'system'] as const;
type ThemeChoice = (typeof ORDER)[number];

const LABEL: Record<ThemeChoice, string> = {
  light: 'Светлая тема',
  dark: 'Тёмная тема',
  system: 'Системная тема',
};

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const current: ThemeChoice = (ORDER as readonly string[]).includes(theme ?? '')
    ? (theme as ThemeChoice)
    : 'system';

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] ?? 'system';
    setTheme(next);
  };

  const baseClass = cn(
    'inline-flex h-9 w-9 items-center justify-center rounded-full',
    'border border-border/70 bg-card/40 text-muted-foreground backdrop-blur',
    'transition-colors hover:text-foreground hover:bg-card/70',
    'focus-visible:outline-none',
    className,
  );

  // Pre-hydration placeholder: same box, no icon/state.
  if (!mounted) {
    return (
      <span className={baseClass} aria-hidden="true">
        <Sun className="h-[1.05rem] w-[1.05rem] opacity-0" />
      </span>
    );
  }

  const Icon = current === 'system' ? Monitor : resolvedTheme === 'dark' ? Moon : Sun;

  return (
    <button
      type="button"
      onClick={cycle}
      className={baseClass}
      aria-label={`Тема: ${LABEL[current]}. Нажмите, чтобы переключить`}
      title={LABEL[current]}
    >
      <Icon className="h-[1.05rem] w-[1.05rem]" />
    </button>
  );
}
