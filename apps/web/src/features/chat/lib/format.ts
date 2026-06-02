/**
 * Lightweight, dependency-free date/time formatting for chat.
 * Uses the platform Intl APIs — no new deps.
 *
 * The relative-time / day-label helpers emit human words ("today", "yesterday",
 * "3 d") that must be localized. Since this is a plain util (no hooks), callers
 * pass their `social` translator in; when omitted the helpers fall back to the
 * original Russian copy so callers outside the i18n migration keep working.
 */

/** Translator shape compatible with next-intl's `useTranslations('social')`. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

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

/**
 * Compact relative time for inbox rows ("12:30", "вчера", "3 дн", "12 мая").
 * Pass a `social` translator to localize the word forms.
 */
export function formatRelativeTime(iso: string, t?: Translate): string {
  const date = new Date(iso);
  const now = new Date();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (diffDays === 0) return time.format(date);
  if (diffDays === 1) return t ? t('relativeTime.yesterday') : 'вчера';
  if (diffDays < 7) return t ? t('relativeTime.daysShort', { count: diffDays }) : `${diffDays} дн`;
  return dayMonth.format(date);
}

/**
 * Human day label for thread day-separators ("Сегодня", "Вчера", "12 мая").
 * Pass a `social` translator to localize the word forms.
 */
export function formatDayLabel(iso: string, t?: Translate): string {
  const date = new Date(iso);
  const now = new Date();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (diffDays === 0) return t ? t('relativeTime.today') : 'Сегодня';
  if (diffDays === 1) return t ? t('relativeTime.yesterdayCap') : 'Вчера';
  if (date.getFullYear() === now.getFullYear()) return dayMonth.format(date);
  return dayMonthYear.format(date);
}

/** Stable day key (local midnight) for grouping messages. */
export function dayKey(iso: string): number {
  return startOfDay(new Date(iso));
}
