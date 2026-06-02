/**
 * ISO 3166-1 alpha-2 country list with display names and flag emojis.
 *
 * Flag emojis are derived from the country code via Regional Indicator Symbols,
 * so we only store `{ code, name }` and compute the flag — this keeps the table
 * tiny and guarantees the flag always matches the code. Codes align with the
 * shared `countryCodeSchema` (uppercase alpha-2).
 */
import type { CountryCode } from '@ruletka/shared-types';

export interface Country {
  /** ISO 3166-1 alpha-2, uppercase. */
  code: CountryCode;
  /** English display name. */
  name: string;
}

/**
 * Convert an ISO alpha-2 code to its flag emoji using Regional Indicator
 * Symbols (U+1F1E6..U+1F1FF). Returns an empty string for malformed input.
 */
export function codeToFlag(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return '';
  const base = 0x1f1e6;
  const upper = code.toUpperCase();
  return String.fromCodePoint(
    base + (upper.charCodeAt(0) - 65),
    base + (upper.charCodeAt(1) - 65),
  );
}

/** A broad, production-ready country list (not exhaustive of every territory). */
export const COUNTRIES: readonly Country[] = [
  { code: 'RU', name: 'Russia' },
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'UA', name: 'Ukraine' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'PL', name: 'Poland' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'TR', name: 'Turkey' },
  { code: 'BR', name: 'Brazil' },
  { code: 'MX', name: 'Mexico' },
  { code: 'AR', name: 'Argentina' },
  { code: 'CA', name: 'Canada' },
  { code: 'IN', name: 'India' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'PH', name: 'Philippines' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'CN', name: 'China' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'TH', name: 'Thailand' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'FI', name: 'Finland' },
  { code: 'DK', name: 'Denmark' },
  { code: 'IE', name: 'Ireland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'GR', name: 'Greece' },
  { code: 'CZ', name: 'Czechia' },
  { code: 'RO', name: 'Romania' },
  { code: 'HU', name: 'Hungary' },
  { code: 'AT', name: 'Austria' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'BE', name: 'Belgium' },
  { code: 'KZ', name: 'Kazakhstan' },
  { code: 'BY', name: 'Belarus' },
  { code: 'GE', name: 'Georgia' },
  { code: 'AM', name: 'Armenia' },
  { code: 'AZ', name: 'Azerbaijan' },
  { code: 'UZ', name: 'Uzbekistan' },
  { code: 'EG', name: 'Egypt' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'IL', name: 'Israel' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'KE', name: 'Kenya' },
  { code: 'MA', name: 'Morocco' },
  { code: 'CO', name: 'Colombia' },
  { code: 'CL', name: 'Chile' },
  { code: 'PE', name: 'Peru' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'SG', name: 'Singapore' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'TW', name: 'Taiwan' },
] as const;

/** Lookup map for O(1) code → country resolution. */
export const COUNTRY_BY_CODE: ReadonlyMap<string, Country> = new Map(
  COUNTRIES.map((c) => [c.code, c]),
);
