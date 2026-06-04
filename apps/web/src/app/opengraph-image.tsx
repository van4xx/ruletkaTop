import { getTranslations } from 'next-intl/server';
import { renderOgCard, SIZE, CONTENT_TYPE } from './og-card';

/**
 * Default Open Graph image for the whole site — served at `/opengraph-image`.
 * Next auto-wires it into `<meta property="og:image">` (with width/height/alt)
 * for every page that doesn't define its own, so the existing root metadata's
 * `openGraph` block gets a branded image without any extra `images` config.
 *
 * Copy is localized via the same `metadata` namespace as the document title.
 * Crawlers don't send the locale cookie, so this renders the default (ru) card —
 * which is exactly the right default for the Russian-first product.
 */
export const alt = 'ruletka.top — видео и голосовая рулетка';
export const size = SIZE;
export const contentType = CONTENT_TYPE;

export default async function OpengraphImage() {
  const t = await getTranslations('metadata');
  return renderOgCard(t('ogTitle'), t('ogDescription'));
}
