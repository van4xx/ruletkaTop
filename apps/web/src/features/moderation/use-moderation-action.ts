'use client';

/**
 * useModerationAction — handles the server→client `mod:action` event during a
 * call, mapping each forced action onto the right UX:
 *
 *   warn → a prominent warning toast (the call continues).
 *   kick → end the current call and return to idle (via `onKick`), plus a toast
 *          explaining why.
 *   ban  → a blocking modal; on acknowledge we sign the user out and redirect to
 *          login (their session is no longer valid). blur/none are advisory and
 *          handled by the local screening loop, so they only surface a toast.
 *
 * The handler is bound through the shared, typed {@link useSocketEvent}, so it
 * lives wherever the call UI mounts (the roulette stage) and tears down with it.
 */
import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@ruletka/ui';
import type { ModerationActionPayload, ModerationLabel } from '@ruletka/shared-types';

import { useSocketEvent } from '@/features/chat/lib/use-socket';
import { useAuth } from '@/features/auth';
import { useModal } from '@/lib/stores/modal-store';

/** Russian copy for each moderation label, for human-readable toasts/modals. */
const LABEL_RU: Record<ModerationLabel, string> = {
  nudity: 'обнажение',
  sexual: 'сексуальный контент',
  violence: 'насилие',
  minor: 'несовершеннолетний в кадре',
  safe: 'нарушение',
  other: 'нарушение правил',
};

function reasonText(p: ModerationActionPayload): string {
  if (p.reason && p.reason.trim()) return p.reason.trim();
  if (p.label) return `Обнаружено: ${LABEL_RU[p.label]}.`;
  return 'Нарушение правил сообщества.';
}

/** Format a ban expiry (unix seconds) into a short Russian hint, if temporary. */
function banExpiryText(banExpiresAt?: number): string {
  if (!banExpiresAt) return 'Аккаунт заблокирован.';
  const ms = banExpiresAt * 1000 - Date.now();
  if (ms <= 0) return 'Аккаунт заблокирован.';
  const hours = Math.ceil(ms / 3_600_000);
  if (hours < 48) return `Доступ ограничен на ~${hours} ч.`;
  const days = Math.ceil(hours / 24);
  return `Доступ ограничен на ~${days} дн.`;
}

export interface UseModerationActionOptions {
  /**
   * Called for a `kick` (and as a safety teardown before a `ban` redirect):
   * the call UI should fully stop media + leave the room. Typically `r.stop`.
   */
  onKick?: () => void;
}

export function useModerationAction({ onKick }: UseModerationActionOptions = {}): void {
  const router = useRouter();
  const { logout } = useAuth();
  const { open } = useModal();

  const handle = useCallback(
    (payload: ModerationActionPayload) => {
      const reason = reasonText(payload);

      switch (payload.action) {
        case 'warn': {
          toast.warning('Предупреждение модерации', {
            description: `${reason} Продолжение нарушений приведёт к блокировке.`,
            duration: 8000,
          });
          break;
        }

        case 'kick': {
          toast.error('Звонок завершён модерацией', { description: reason, duration: 8000 });
          onKick?.();
          break;
        }

        case 'ban': {
          // Tear the call down immediately, then force a blocking acknowledgement
          // that signs the user out (their token is now invalid server-side).
          onKick?.();
          open('confirm', {
            title: 'Аккаунт заблокирован',
            body: `${reason} ${banExpiryText(payload.banExpiresAt)}`,
            confirmLabel: 'Понятно',
            cancelLabel: 'Закрыть',
            danger: true,
            onConfirm: async () => {
              await logout();
              router.replace('/login');
            },
            onCancel: () => {
              // Even on dismissal the session is dead — sign out + bounce.
              void logout().finally(() => router.replace('/login'));
            },
          });
          break;
        }

        case 'blur':
        case 'none':
        default: {
          // Advisory only: the on-device screening loop already blurs/cuts the
          // local preview AND surfaces its own toast, so we don't double-notify
          // here. Nothing to do for `none`.
          break;
        }
      }
    },
    [onKick, open, logout, router],
  );

  useSocketEvent('mod:action', handle);
}
