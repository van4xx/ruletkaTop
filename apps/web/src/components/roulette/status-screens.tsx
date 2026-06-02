'use client';

/**
 * Centered overlay screens for every non-connected roulette state: idle hero,
 * searching radar, ended interstitial, media/permission errors, and a sign-in
 * prompt. Kept presentational — the stage decides which to show.
 */
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  CameraOff,
  LogIn,
  MicOff,
  Radar,
  RefreshCw,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import { Button, Spinner } from '@ruletka/ui';
import type { RouletteError } from '@/features/roulette/types';
import { cn } from '@/lib/cn';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="flex max-w-md flex-col items-center gap-5 px-6 text-center"
    >
      {children}
    </motion.div>
  );
}

/** Idle pre-flight hero (before the first Start). */
export function IdleScreen({ isVideo }: { isVideo: boolean }) {
  const t = useTranslations('roulette');
  return (
    <Shell>
      <div className="relative grid h-24 w-24 place-items-center">
        <div
          aria-hidden="true"
          className="absolute inset-0 animate-pulse rounded-full bg-[radial-gradient(circle,var(--color-neon-violet),transparent_70%)] opacity-50 blur-xl"
        />
        <span className="relative inline-flex h-16 w-16 items-center justify-center rounded-2xl glass-panel">
          <Sparkles className="h-8 w-8 text-[var(--color-neon-cyan)]" />
        </span>
      </div>
      <div className="space-y-2">
        <h2 className="font-display text-2xl font-bold text-foreground drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
          {isVideo ? t('modeName.video') : t('modeName.voice')}
        </h2>
        <p className="text-balance text-sm text-muted-foreground">
          {isVideo ? t('status.idle.video') : t('status.idle.voice')}
        </p>
      </div>
    </Shell>
  );
}

/** Searching / waiting radar. */
export function SearchingScreen({
  positionHint,
  longWait,
}: {
  positionHint: number | null;
  longWait: boolean;
}) {
  const t = useTranslations('roulette');
  return (
    <Shell>
      <div className="relative grid h-28 w-28 place-items-center" aria-hidden="true">
        <span className="absolute inset-0 animate-ping rounded-full border border-[var(--color-neon-violet)]/40" />
        <span className="absolute inset-3 animate-ping rounded-full border border-[var(--color-neon-cyan)]/30 [animation-delay:200ms]" />
        <span className="relative inline-flex h-16 w-16 items-center justify-center rounded-full glass-panel">
          <Radar className="h-7 w-7 animate-spin text-[var(--color-neon-cyan)] [animation-duration:3s]" />
        </span>
      </div>
      <div className="space-y-2" role="status" aria-live="polite">
        <h2 className="font-display text-xl font-bold">{t('status.searching.title')}</h2>
        <p className="text-sm text-muted-foreground">
          {longWait
            ? t('status.searching.longWait')
            : positionHint != null && positionHint > 0
              ? t('status.searching.position', { position: positionHint })
              : t('status.searching.default')}
        </p>
      </div>
    </Shell>
  );
}

/** Brief interstitial when a peer leaves before auto-requeue. */
export function EndedScreen() {
  const t = useTranslations('roulette');
  return (
    <Shell>
      <Spinner size="lg" tone="accent" />
      <div className="space-y-1">
        <h2 className="font-display text-lg font-bold">{t('status.ended.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('status.ended.subtitle')}</p>
      </div>
    </Shell>
  );
}

/**
 * Transient overlay while we attempt an ICE-restart recovery of the CURRENT
 * call (the link dropped but the peer is still on the line). Distinct from
 * EndedScreen — we're trying to resume, not find someone new.
 */
export function ReconnectingScreen({ attempt }: { attempt: number }) {
  const t = useTranslations('roulette');
  return (
    <Shell>
      <span className="relative inline-flex h-16 w-16 items-center justify-center rounded-2xl glass-panel text-[var(--color-neon-cyan)]">
        <RefreshCw className="h-7 w-7 animate-spin [animation-duration:1.4s]" />
      </span>
      <div className="space-y-1">
        <h2 className="font-display text-lg font-bold drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
          {t('status.reconnecting.title')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {attempt > 1
            ? t('status.reconnecting.retry', { attempt })
            : t('status.reconnecting.first')}
        </p>
      </div>
    </Shell>
  );
}

/** Recoverable error (permission / device / network). */
export function ErrorScreen({ error, onRetry }: { error: RouletteError; onRetry: () => void }) {
  const t = useTranslations('roulette');
  const tc = useTranslations('common');
  const ICONS = {
    denied: MicOff,
    notfound: CameraOff,
    inuse: AlertTriangle,
    insecure: AlertTriangle,
    socket: WifiOff,
    timeout: WifiOff,
    unknown: AlertTriangle,
  } as const;
  const Icon = ICONS[error.kind] ?? ICONS.unknown;
  const title = t(`status.error.${error.kind in ICONS ? error.kind : 'unknown'}`);
  // The auth case is a `socket` error whose message is the localized sign-in
  // prompt; compare against the same key (locale-independent) rather than the
  // text itself.
  const isAuth = error.kind === 'socket' && error.message === t('errors.signInToStart');

  return (
    <Shell>
      <span
        className={cn(
          'inline-flex h-16 w-16 items-center justify-center rounded-2xl',
          'glass-panel text-destructive',
        )}
      >
        <Icon className="h-8 w-8" />
      </span>
      <div className="space-y-2">
        <h2 className="font-display text-xl font-bold">{title}</h2>
        <p className="text-balance text-sm text-muted-foreground">{error.message}</p>
      </div>
      {isAuth ? (
        <Button asChild variant="primary" className="gap-2">
          <Link href="/login">
            <LogIn className="h-4 w-4" />
            {tc('signIn')}
          </Link>
        </Button>
      ) : (
        <Button variant="primary" onClick={onRetry}>
          {t('status.error.retry')}
        </Button>
      )}
    </Shell>
  );
}

/** Shown when there is definitively no session token. */
export function SignInScreen({ isVideo }: { isVideo: boolean }) {
  const t = useTranslations('roulette');
  const tc = useTranslations('common');
  return (
    <Shell>
      <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl glass-panel">
        <LogIn className="h-8 w-8 text-[var(--color-neon-violet)]" />
      </span>
      <div className="space-y-2">
        <h2 className="font-display text-xl font-bold">{t('status.signIn.title')}</h2>
        <p className="text-balance text-sm text-muted-foreground">
          {t('status.signIn.body', {
            mode: isVideo ? t('modeName.video') : t('modeName.voice'),
          })}
        </p>
      </div>
      <div className="flex gap-3">
        <Button asChild variant="primary">
          <Link href="/login">{tc('signIn')}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/register">{tc('signUp')}</Link>
        </Button>
      </div>
    </Shell>
  );
}
