import { Bell, Gift, MessagesSquare, Phone, UserPlus } from 'lucide-react';
import type { AppNotification } from '@ruletka/shared-types';
import { ROUTES } from '@/config/nav';

type Kind = AppNotification['kind'];

export interface NotificationKindMeta {
  label: string;
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
    label: 'Заявка в друзья',
    icon: UserPlus,
    chip: 'bg-[color-mix(in_oklch,var(--color-neon-violet)_18%,transparent)] text-[var(--color-neon-violet)]',
    href: '/friends/requests',
  },
  message: {
    label: 'Сообщение',
    icon: MessagesSquare,
    chip: 'bg-[color-mix(in_oklch,var(--color-neon-cyan)_18%,transparent)] text-[var(--color-neon-cyan)]',
    href: ROUTES.chats,
  },
  gift: {
    label: 'Подарок',
    icon: Gift,
    chip: 'bg-[color-mix(in_oklch,var(--coin)_18%,transparent)] text-[var(--coin)]',
    href: ROUTES.me,
  },
  call: {
    label: 'Звонок',
    icon: Phone,
    chip: 'bg-[color-mix(in_oklch,var(--color-neon-magenta)_18%,transparent)] text-[var(--color-neon-magenta)]',
    href: ROUTES.friends,
  },
  system: {
    label: 'Система',
    icon: Bell,
    chip: 'bg-muted text-muted-foreground',
    href: null,
  },
};

/** Compact relative time in Russian: "только что", "5 мин", "3 ч", "2 дн". */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  if (diffMs < 0) return 'только что';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return 'только что';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} дн назад`;
  try {
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(then);
  } catch {
    return new Date(then).toLocaleDateString('ru-RU');
  }
}
