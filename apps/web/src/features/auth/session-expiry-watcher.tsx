'use client';

/**
 * Surfaces a single, localized "session expired — sign in again" toast and tears
 * the session down when the api client reports a HARD refresh rejection (a real
 * `401`, not a transient network/5xx blip).
 *
 * Why a component and not inline in the api client: the toast + i18n + the auth
 * store live in the React/UI layer, while `lib/api.ts` is framework-agnostic and
 * must not import them. The api client instead emits an event
 * ({@link onSessionExpired}); this watcher — mounted once at the app root —
 * subscribes, clears auth, drops the socket + the cached `/auth/me`, and shows
 * the toast. The api client already cleared the in-memory token and de-duplicates
 * the signal, so a wave of concurrent 401s yields exactly one toast.
 *
 * Renders nothing.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from '@ruletka/ui';
import { onSessionExpired } from '@/lib/api';
import { disconnectSocket } from '@/lib/socket';
import { useAuthStore } from '@/lib/stores/auth-store';
import { CURRENT_USER_KEY } from './use-auth';

export function SessionExpiryWatcher(): null {
  const t = useTranslations('auth');
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribe = onSessionExpired(() => {
      // Only surface the toast for a session that was actually established — a
      // hard 401 while already signed out (e.g. a stale presence cookie on a
      // never-logged-in tab) should clear silently, not nag a visitor.
      const wasAuthenticated = useAuthStore.getState().isAuthenticated;

      useAuthStore.getState().clear();
      disconnectSocket();
      queryClient.removeQueries({ queryKey: CURRENT_USER_KEY });

      if (wasAuthenticated) {
        toast.error(t('session.expiredToast'), {
          description: t('session.expiredToastDescription'),
        });
      }
    });
    return unsubscribe;
  }, [t, queryClient]);

  return null;
}
