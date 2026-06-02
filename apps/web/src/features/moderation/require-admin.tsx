'use client';

/**
 * Client-side admin/moderator route guard for the moderation surface.
 *
 * Mirrors `features/auth/require-auth` but additionally requires a privileged
 * role (`admin` or `moderator`). The REAL authority is the API (every
 * `/moderation/*` route is role-gated server-side); this guard is purely a UX
 * affordance so non-privileged users see a clean "no access" panel instead of a
 * wall of failed requests, and unauthenticated users bounce to /login.
 *
 * Wrap the page content:
 *   <RequireAdmin><ModerationQueue /></RequireAdmin>
 */
import { useEffect, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ShieldAlert } from 'lucide-react';
import { Spinner } from '@ruletka/ui';
import { useAuth } from '@/features/auth';
import { StatePanel } from '@/components/social/state-views';

/** Roles permitted to access the moderation tools. */
const PRIVILEGED_ROLES = new Set(['admin', 'moderator']);

export function RequireAdmin({ children }: { children: ReactNode }) {
  const t = useTranslations('misc');
  const tc = useTranslations('common');
  const { user, isAuthenticated, isReady } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isPrivileged = Boolean(user && PRIVILEGED_ROLES.has(user.role));

  // Unauthenticated → bounce to login (privileged check happens after auth).
  useEffect(() => {
    if (isReady && !isAuthenticated) {
      const next = encodeURIComponent(pathname || '/');
      router.replace(`/login?next=${next}`);
    }
  }, [isReady, isAuthenticated, router, pathname]);

  // Booting, or about to redirect an anonymous visitor → spinner.
  if (!isReady || !isAuthenticated) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" aria-busy="true">
        <Spinner size="lg" label={tc('loading')} />
      </div>
    );
  }

  // Authenticated but not privileged → explicit, on-brand "no access" panel.
  if (!isPrivileged) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <StatePanel
          icon={<ShieldAlert className="h-7 w-7 text-[var(--color-neon-magenta)]" />}
          title={t('moderation.accessDeniedTitle')}
          description={t('moderation.accessDeniedDesc')}
        />
      </div>
    );
  }

  return <>{children}</>;
}
