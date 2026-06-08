/**
 * Lightweight, dependency-free date/time formatting for chat.
 * Uses the platform Intl APIs — no new deps.
 *
 * The relative-time / day-label helpers emit human words ("today", "yesterday",
 * "3 d") that must be localized. Since this is a plain util (no hooks), callers
 * pass their `social` translator in; when omitted the helpers fall back to the
 * original Russian copy so callers outside the i18n migration keep working.
 *
 * The clock / day / month formatting is locale-sensitive too: callers thread the
 * active locale (`useLocale()`, a short tag like `ru`/`en`) through as `locale`,
 * which is mapped to a BCP-47 tag with an explicit region for stable, native
 * date formatting. Omitting it falls back to the Russian default.
 */

/** Translator shape compatible with next-intl's `useTranslations('social')`. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Short next-intl locale → BCP-47 tag (explicit region for stable formatting). */
const BCP47: Record<string, string> = { ru: 'ru-RU', en: 'en-US' };

/** Resolve a short next-intl locale to a BCP-47 tag (defaults to Russian). */
function toBcp47(locale?: string): string {
  if (!locale) return 'ru-RU';
  return BCP47[locale] ?? locale;
}

/**
 * Cache `Intl.DateTimeFormat` instances per (locale, kind) so repeated calls in
 * a render don't re-instantiate the (relatively expensive) formatters.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function dtf(locale: string, kind: 'time' | 'dayMonth' | 'dayMonthYear'): Intl.DateTimeFormat {
  const key = `${locale}:${kind}`;
  let f = formatterCache.get(key);
  if (!f) {
    const options: Intl.DateTimeFormatOptions =
      kind === 'time'
        ? { hour: '2-digit', minute: '2-digit' }
        : kind === 'dayMonth'
          ? { day: 'numeric', month: 'long' }
          : { day: 'numeric', month: 'long', year: 'numeric' };
    f = new Intl.DateTimeFormat(locale, options);
    formatterCache.set(key, f);
  }
  return f;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** `HH:MM` clock time of a message, in the active locale. */
export function formatClock(iso: string, locale?: string): string {
  return dtf(toBcp47(locale), 'time').format(new Date(iso));
}

/**
 * Compact relative time for inbox rows ("12:30", "вчера", "3 дн", "12 мая").
 * Pass a `social` translator to localize the word forms and the active locale
 * to localize the clock / date fallbacks.
 */
export function formatRelativeTime(iso: string, t?: Translate, locale?: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  const tag = toBcp47(locale);

  if (diffDays === 0) return dtf(tag, 'time').format(date);
  if (diffDays === 1) return t ? t('relativeTime.yesterday') : 'вчера';
  if (diffDays < 7) return t ? t('relativeTime.daysShort', { count: diffDays }) : `${diffDays} дн`;
  return dtf(tag, 'dayMonth').format(date);
}

/**
 * Human day label for thread day-separators ("Сегодня", "Вчера", "12 мая").
 * Pass a `social` translator to localize the word forms and the active locale
 * to localize the date fallbacks.
 */
export function formatDayLabel(iso: string, t?: Translate, locale?: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  const tag = toBcp47(locale);

  if (diffDays === 0) return t ? t('relativeTime.today') : 'Сегодня';
  if (diffDays === 1) return t ? t('relativeTime.yesterdayCap') : 'Вчера';
  if (date.getFullYear() === now.getFullYear()) return dtf(tag, 'dayMonth').format(date);
  return dtf(tag, 'dayMonthYear').format(date);
}

/** Stable day key (local midnight) for grouping messages. */
export function dayKey(iso: string): number {
  return startOfDay(new Date(iso));
}
