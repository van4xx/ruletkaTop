import { Bell, Gift, MessagesSquare, Phone, UserPlus } from 'lucide-react';
import type { AppNotification } from '@ruletka/shared-types';
import { ROUTES } from '@/config/nav';

type Kind = AppNotification['kind'];

export interface NotificationKindMeta {
  /** `misc.notifications.*` key for the kind's label. */
  labelKey: string;
  icon: typeof Bell;
  /** Tailwind classes for the icon chip (bg + text). */
  chip: string;
  /** Where tapping the notification should take the user (best-effort). */
  href: string | null;
}

/**
 * Per-kind presentation + routing for an {@link AppNotification}. The socket
 * payload carries only `{ id, kind, title, body, createdAt }` (no entity id),
 * so deep links resolve to the relevant section rather than a specific record.
 */
export const NOTIFICATION_META: Record<Kind, NotificationKindMeta> = {
  friend_request: {
    labelKey: 'notifications.kindFriendRequest',
    icon: UserPlus,
    chip: 'bg-[color-mix(in_oklch,var(--color-neon-violet)_18%,transparent)] text-[var(--color-neon-violet)]',
    href: '/friends/requests',
  },
  message: {
    labelKey: 'notifications.kindMessage',
    icon: MessagesSquare,
    chip: 'bg-[color-mix(in_oklch,var(--color-neon-cyan)_18%,transparent)] text-[var(--color-neon-cyan)]',
    href: ROUTES.chats,
  },
  gift: {
    labelKey: 'notifications.kindGift',
    icon: Gift,
    chip: 'bg-[color-mix(in_oklch,var(--coin)_18%,transparent)] text-[var(--coin)]',
    href: ROUTES.me,
  },
  call: {
    labelKey: 'notifications.kindCall',
    icon: Phone,
    chip: 'bg-[color-mix(in_oklch,var(--color-neon-magenta)_18%,transparent)] text-[var(--color-neon-magenta)]',
    href: ROUTES.friends,
  },
  system: {
    labelKey: 'notifications.kindSystem',
    icon: Bell,
    chip: 'bg-muted text-muted-foreground',
    href: null,
  },
};

/** Translator shape compatible with next-intl's `useTranslations('misc')`. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * Compact, localized relative time, e.g. "just now", "5 min ago", "3 h ago".
 *
 * When a `misc` translator is provided the unit strings come from the message
 * catalogue; without one it falls back to the original Russian copy (kept for
 * callers outside the i18n migration that still pass a single argument).
 */
export function formatRelativeTime(iso: string, t?: Translate, locale = 'ru-RU'): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const justNow = () => (t ? t('notifications.timeJustNow') : 'только что');
  if (diffMs < 0) return justNow();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return justNow();
  const min = Math.floor(sec / 60);
  if (min < 60) return t ? t('notifications.timeMinutes', { count: min }) : `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return t ? t('notifications.timeHours', { count: hours }) : `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days < 7) return t ? t('notifications.timeDays', { count: days }) : `${days} дн назад`;
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(then);
  } catch {
    return new Date(then).toLocaleDateString(locale);
  }
}
