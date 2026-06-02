/**
 * Lightweight, dependency-free date/time formatting for chat (Russian locale).
 * Uses the platform Intl APIs — no new deps.
 */

const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const dayMonthYear = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** `HH:MM` clock time of a message. */
export function formatClock(iso: string): string {
  return time.format(new Date(iso));
}

/** Compact relative time for inbox rows ("12:30", "вчера", "3 дн", "12 мая"). */
export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (diffDays === 0) return time.format(date);
  if (diffDays === 1) return 'вчера';
  if (diffDays < 7) return `${diffDays} дн`;
  return dayMonth.format(date);
}

/** Human day label for thread day-separators ("Сегодня", "Вчера", "12 мая"). */
export function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (diffDays === 0) return 'Сегодня';
  if (diffDays === 1) return 'Вчера';
  if (date.getFullYear() === now.getFullYear()) return dayMonth.format(date);
  return dayMonthYear.format(date);
}

/** Stable day key (local midnight) for grouping messages. */
export function dayKey(iso: string): number {
  return startOfDay(new Date(iso));
}
