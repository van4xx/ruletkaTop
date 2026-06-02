'use client';

/**
 * Anonymous header CTAs — «Войти» (ghost) + «Регистрация» (gradient).
 *
 * The gradient button mirrors the landing page's primary CTA treatment (the
 * violet→magenta sweep) so the brand language is continuous. Memoised.
 */
import { memo } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';

function AuthCtaImpl({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Link
        href="/login"
        className={cn(
          'inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium',
          'text-muted-foreground outline-none transition-colors hover:text-foreground',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        )}
      >
        Войти
      </Link>
      <Link
        href="/register"
        className={cn(
          'group relative inline-flex items-center justify-center overflow-hidden rounded-full px-4 py-2',
          'text-sm font-semibold text-primary-foreground outline-none',
          'bg-gradient-to-r from-[var(--color-neon-violet)] via-[var(--color-neon-magenta)] to-[var(--color-neon-violet)] bg-[length:200%_100%] bg-left',
          'shadow-[0_6px_22px_-10px_var(--color-neon-violet)] transition-[background-position,transform] duration-500',
          'hover:bg-right hover:-translate-y-0.5 active:translate-y-0',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        )}
      >
        Регистрация
      </Link>
    </div>
  );
}

export const AuthCta = memo(AuthCtaImpl);
