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
import { useTranslations } from 'next-intl';
import { toast } from '@ruletka/ui';
import type { ModerationActionPayload, ModerationLabel } from '@ruletka/shared-types';

import { useSocketEvent } from '@/features/chat/lib/use-socket';
import { useAuth } from '@/features/auth';
import { useModal } from '@/lib/stores/modal-store';

/** Translator shape compatible with next-intl's `useTranslations('misc')`. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

/** `misc.moderation.*` key for each moderation label's inline human-readable copy. */
const LABEL_KEYS: Record<ModerationLabel, string> = {
  nudity: 'moderation.labelNudityInline',
  sexual: 'moderation.labelSexualInline',
  violence: 'moderation.labelViolenceInline',
  minor: 'moderation.labelMinorInline',
  safe: 'moderation.labelViolationInline',
  other: 'moderation.labelRulesInline',
};

function reasonText(p: ModerationActionPayload, t: Translate): string {
  if (p.reason && p.reason.trim()) return p.reason.trim();
  if (p.label) return t('moderation.reasonDetected', { label: t(LABEL_KEYS[p.label]) });
  return t('moderation.reasonGeneric');
}

/** Format a ban expiry (unix seconds) into a short localized hint, if temporary. */
function banExpiryText(t: Translate, banExpiresAt?: number): string {
  if (!banExpiresAt) return t('moderation.banPermanent');
  const ms = banExpiresAt * 1000 - Date.now();
  if (ms <= 0) return t('moderation.banPermanent');
  const hours = Math.ceil(ms / 3_600_000);
  if (hours < 48) return t('moderation.banHours', { hours });
  const days = Math.ceil(hours / 24);
  return t('moderation.banDays', { days });
}

export interface UseModerationActionOptions {
  /**
   * Called for a `kick` (and as a safety teardown before a `ban` redirect):
   * the call UI should fully stop media + leave the room. Typically `r.stop`.
   */
  onKick?: () => void;
}

export function useModerationAction({ onKick }: UseModerationActionOptions = {}): void {
  const t = useTranslations('misc');
  const router = useRouter();
  const { logout } = useAuth();
  const { open } = useModal();

  const handle = useCallback(
    (payload: ModerationActionPayload) => {
      const reason = reasonText(payload, t);

      switch (payload.action) {
        case 'warn': {
          toast.warning(t('moderation.actionToastWarnTitle'), {
            description: t('moderation.actionToastWarnDescription', { reason }),
            duration: 8000,
          });
          break;
        }

        case 'kick': {
          toast.error(t('moderation.actionToastKickTitle'), {
            description: reason,
            duration: 8000,
          });
          onKick?.();
          break;
        }

        case 'ban': {
          // Tear the call down immediately, then force a blocking acknowledgement
          // that signs the user out (their token is now invalid server-side).
          onKick?.();
          open('confirm', {
            title: t('moderation.banModalTitle'),
            body: `${reason} ${banExpiryText(t, payload.banExpiresAt)}`,
            confirmLabel: t('moderation.banModalConfirm'),
            cancelLabel: t('moderation.banModalCancel'),
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
    [onKick, open, logout, router, t],
  );

  // `mod:action` is emitted by the /mm gateway during a call.
  useSocketEvent('mod:action', handle, '/mm');
}
