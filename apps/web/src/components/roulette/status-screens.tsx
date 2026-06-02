'use client';

/**
 * Centered overlay screens for every non-connected roulette state: idle hero,
 * searching radar, ended interstitial, media/permission errors, and a sign-in
 * prompt. Kept presentational — the stage decides which to show.
 */
import Link from 'next/link';
import { motion } from 'framer-motion';
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
          {isVideo ? 'Видеорулетка' : 'Голосовая рулетка'}
        </h2>
        <p className="text-balance text-sm text-muted-foreground">
          {isVideo
            ? 'Нажмите «Начать» — мы попросим доступ к камере и микрофону и найдём собеседника.'
            : 'Нажмите «Начать» — мы попросим доступ к микрофону и найдём собеседника.'}
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
        <h2 className="font-display text-xl font-bold">Ищем собеседника…</h2>
        <p className="text-sm text-muted-foreground">
          {longWait
            ? 'Пока тихо в эфире. Попробуйте смягчить фильтры — найдём быстрее.'
            : positionHint != null && positionHint > 0
              ? `Вы в очереди: позиция ${positionHint}`
              : 'Это займёт пару секунд.'}
        </p>
      </div>
    </Shell>
  );
}

/** Brief interstitial when a peer leaves before auto-requeue. */
export function EndedScreen() {
  return (
    <Shell>
      <Spinner size="lg" tone="accent" />
      <div className="space-y-1">
        <h2 className="font-display text-lg font-bold">Собеседник отключился</h2>
        <p className="text-sm text-muted-foreground">Ищем следующего…</p>
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
  return (
    <Shell>
      <span className="relative inline-flex h-16 w-16 items-center justify-center rounded-2xl glass-panel text-[var(--color-neon-cyan)]">
        <RefreshCw className="h-7 w-7 animate-spin [animation-duration:1.4s]" />
      </span>
      <div className="space-y-1">
        <h2 className="font-display text-lg font-bold drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
          Восстанавливаем соединение…
        </h2>
        <p className="text-sm text-muted-foreground">
          {attempt > 1
            ? `Связь нестабильна. Попытка ${attempt} — не закрывайте окно.`
            : 'Связь прервалась. Пробуем восстановить — не закрывайте окно.'}
        </p>
      </div>
    </Shell>
  );
}

/** Recoverable error (permission / device / network). */
export function ErrorScreen({
  error,
  onRetry,
}: {
  error: RouletteError;
  onRetry: () => void;
}) {
  const map = {
    denied: { Icon: MicOff, title: 'Нет доступа к устройствам' },
    notfound: { Icon: CameraOff, title: 'Устройство не найдено' },
    inuse: { Icon: AlertTriangle, title: 'Устройство занято' },
    insecure: { Icon: AlertTriangle, title: 'Небезопасное соединение' },
    socket: { Icon: WifiOff, title: 'Нет соединения' },
    timeout: { Icon: WifiOff, title: 'Превышено время ожидания' },
    unknown: { Icon: AlertTriangle, title: 'Что-то пошло не так' },
  } as const;
  const { Icon, title } = map[error.kind] ?? map.unknown;
  const isAuth = error.kind === 'socket' && /войдите/i.test(error.message);

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
            Войти
          </Link>
        </Button>
      ) : (
        <Button variant="primary" onClick={onRetry}>
          Попробовать снова
        </Button>
      )}
    </Shell>
  );
}

/** Shown when there is definitively no session token. */
export function SignInScreen({ isVideo }: { isVideo: boolean }) {
  return (
    <Shell>
      <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl glass-panel">
        <LogIn className="h-8 w-8 text-[var(--color-neon-violet)]" />
      </span>
      <div className="space-y-2">
        <h2 className="font-display text-xl font-bold">Войдите, чтобы начать</h2>
        <p className="text-balance text-sm text-muted-foreground">
          {isVideo ? 'Видеорулетка' : 'Голосовая рулетка'} доступна авторизованным
          пользователям. Это займёт минуту.
        </p>
      </div>
      <div className="flex gap-3">
        <Button asChild variant="primary">
          <Link href="/login">Войти</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/register">Регистрация</Link>
        </Button>
      </div>
    </Shell>
  );
}
