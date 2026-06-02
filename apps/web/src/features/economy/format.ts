/**
 * Small, locale-aware formatting helpers shared across the economy features.
 * Russian-first product → default to the `ru-RU` locale.
 */

const RU = 'ru-RU';

/** Group a coin/number figure: 12500 → "12 500". */
export function formatNumber(value: number, locale = RU): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}

/** Format a rouble price: 499 → "499 ₽". */
export function formatRub(value: number, locale = RU): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${value} ₽`;
  }
}

/** Relative-ish, human date for ledger rows: "31 мая, 14:05". */
export function formatDateTime(iso: string, locale = RU): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return d.toLocaleString(locale);
  }
}

/** Compact remaining time until an ISO instant: "5 ч 12 мин", "3 дн". */
export function formatTimeLeft(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return 'истекло';
  const minutes = Math.floor(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours > 0 ? `${days} дн ${hours} ч` : `${days} дн`;
  if (hours > 0) return `${hours} ч ${mins} мин`;
  return `${mins} мин`;
}

/** Price-per-coin, used to highlight the best-value package. */
export function pricePerCoin(priceRub: number, coins: number, bonus = 0): number {
  const total = coins + bonus;
  return total > 0 ? priceRub / total : Infinity;
}
