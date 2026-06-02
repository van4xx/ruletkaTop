import type { Locale } from './config';

/**
 * Loads + merges every message namespace for a locale into one dictionary.
 *
 * Each namespace is a SEPARATE JSON file (`messages/<locale>/<namespace>.json`)
 * so that parallel work on different feature areas never collides on one giant
 * file. Every import below is a static string literal (one per namespace ×
 * locale), so both webpack and Turbopack code-split them deterministically — no
 * dynamic-path context modules, which keeps the build predictable.
 *
 * ADDING A NAMESPACE: create `messages/ru/<ns>.json` + `messages/en/<ns>.json`,
 * then add one `import(...)` line to BOTH branches below. This file is the single
 * integration point for the i18n fan-out.
 */
export type Messages = Record<string, unknown>;

export async function loadMessages(locale: Locale): Promise<Messages> {
  if (locale === 'en') {
    return {
      common: (await import('../../messages/en/common.json')).default,
      nav: (await import('../../messages/en/nav.json')).default,
      landing: (await import('../../messages/en/landing.json')).default,
      footer: (await import('../../messages/en/footer.json')).default,
    };
  }
  // ru — the default locale and the fallback for any missing message.
  return {
    common: (await import('../../messages/ru/common.json')).default,
    nav: (await import('../../messages/ru/nav.json')).default,
    landing: (await import('../../messages/ru/landing.json')).default,
    footer: (await import('../../messages/ru/footer.json')).default,
  };
}
