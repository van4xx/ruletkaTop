'use client';

/**
 * Active sessions / devices — lets the signed-in user review every device that
 * currently holds a live login and revoke them.
 *
 * Backed by `useSessions` (`GET /auth/sessions`); each row is one login (a
 * refresh-token rotation family). The device the user is on right now is flagged
 * `current` — it sorts first, carries a "this device" badge, and is NOT
 * sign-out-able from the list (you leave it via normal logout). Per-row
 * "Sign out" revokes that device (`DELETE /auth/sessions/:id`); "Sign out
 * everywhere else" revokes all the others (`DELETE /auth/sessions`) behind a
 * confirm dialog.
 *
 * Handles loading (skeletons), error (retry), and the single-session case (the
 * "everywhere" action hides when there are no other devices).
 */
import { useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Laptop, LogOut, ShieldCheck, Smartphone } from 'lucide-react';
import type { AuthSession } from '@ruletka/shared-types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Skeleton,
  toast,
} from '@ruletka/ui';
import {
  useRevokeOtherSessions,
  useRevokeSession,
  useSessions,
} from '@/features/settings/use-settings';
import { useErrorMessage } from '@/lib/error-message';
import { cn } from '@/lib/cn';
import { SettingsSection } from './primitives';

/** Coarse device class derived from a best-effort User-Agent string. */
type DeviceKind = 'mobile' | 'desktop';

function deviceKindFor(userAgent: string | null): DeviceKind {
  if (userAgent && /Mobi|Android|iPhone|iPad|iPod/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

/**
 * Best-effort "Browser on OS" label from a User-Agent. Intentionally tiny — full
 * UA parsing is overkill here; we only want a recognisable hint. Returns `null`
 * when nothing matches so the caller can fall back to localized copy.
 */
function deviceLabelFor(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const browser =
    /Edg\//.test(userAgent)
      ? 'Edge'
      : /OPR\/|Opera/.test(userAgent)
        ? 'Opera'
        : /Firefox\//.test(userAgent)
          ? 'Firefox'
          : /Chrome\//.test(userAgent)
            ? 'Chrome'
            : /Safari\//.test(userAgent)
              ? 'Safari'
              : null;
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /iPhone|iPad|iPod/.test(userAgent)
      ? 'iOS'
      : /Mac OS X|Macintosh/.test(userAgent)
        ? 'macOS'
        : /Android/.test(userAgent)
          ? 'Android'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  if (browser && os) return `${browser} · ${os}`;
  return browser ?? os;
}

export function ActiveSessionsSection() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const format = useFormatter();
  const errorMessage = useErrorMessage();

  const { data: sessions, isLoading, isError, error, refetch } = useSessions();
  const revokeOne = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();

  const [confirmOpen, setConfirmOpen] = useState(false);

  const otherCount = useMemo(
    () => (sessions ?? []).filter((s) => !s.current).length,
    [sessions],
  );

  const handleRevokeOne = (session: AuthSession) => {
    revokeOne.mutate(session.id, {
      onSuccess: () => toast.success(t('sessions.revokedOne')),
      onError: (e) => toast.error(t('sessions.revokeError'), { description: errorMessage(e) }),
    });
  };

  const handleRevokeOthers = () => {
    revokeOthers.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('sessions.revokedOthers'));
        setConfirmOpen(false);
      },
      onError: (e) => toast.error(t('sessions.revokeError'), { description: errorMessage(e) }),
    });
  };

  return (
    <SettingsSection
      title={t('sessions.title')}
      description={t('sessions.description')}
      icon={<ShieldCheck />}
      footer={
        otherCount > 0 ? (
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogTrigger asChild>
              <Button variant="danger" size="sm" leadingIcon={<LogOut className="h-4 w-4" />}>
                {t('sessions.signOutEverywhere')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('sessions.signOutEverywhereTitle')}</DialogTitle>
                <DialogDescription>
                  {t('sessions.signOutEverywhereDescription', { count: otherCount })}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setConfirmOpen(false)}>
                  {tc('cancel')}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  loading={revokeOthers.isPending}
                  onClick={handleRevokeOthers}
                >
                  {t('sessions.signOutEverywhereConfirm')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : undefined
      }
    >
      {isLoading ? (
        <div className="space-y-3">
          <SessionRowSkeleton />
          <SessionRowSkeleton />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            {error?.isNetworkError ? errorMessage(error) : t('sessions.loadError')}
          </p>
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            {tc('retry')}
          </Button>
        </div>
      ) : !sessions || sessions.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('sessions.empty')}</p>
      ) : (
        <ul className="divide-y divide-border/50">
          {sessions.map((session) => {
            const kind = deviceKindFor(session.userAgent);
            const Icon = kind === 'mobile' ? Smartphone : Laptop;
            const label = deviceLabelFor(session.userAgent) ?? t('sessions.unknownDevice');
            const lastActive = format.relativeTime(new Date(session.lastActiveAt));
            return (
              <li
                key={session.id}
                className="flex items-center gap-3 py-3.5 first:pt-0 last:pb-0"
              >
                <span
                  className={cn(
                    'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1',
                    session.current
                      ? 'bg-[var(--color-neon-violet)]/12 text-[var(--color-neon-violet)] ring-[var(--color-neon-violet)]/40'
                      : 'bg-card/70 text-muted-foreground ring-border/70',
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="truncate text-sm font-medium text-foreground">{label}</span>
                    {session.current && (
                      <span className="inline-flex items-center rounded-full bg-[var(--color-neon-violet)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-neon-violet)]">
                        {t('sessions.currentBadge')}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {session.ip
                      ? t('sessions.metaWithIp', { lastActive, ip: session.ip })
                      : t('sessions.meta', { lastActive })}
                  </p>
                </div>

                {session.current ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t('sessions.thisDevice')}
                  </span>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    leadingIcon={<LogOut className="h-4 w-4" />}
                    loading={revokeOne.isPending && revokeOne.variables === session.id}
                    onClick={() => handleRevokeOne(session)}
                  >
                    {t('sessions.signOut')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SettingsSection>
  );
}

function SessionRowSkeleton() {
  return (
    <div className="flex items-center gap-3 py-1">
      <Skeleton className="h-10 w-10 rounded-xl" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
      </div>
      <Skeleton className="h-8 w-24 rounded-lg" />
    </div>
  );
}
