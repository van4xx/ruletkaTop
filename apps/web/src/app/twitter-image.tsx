import { getTranslations } from 'next-intl/server';
import { renderOgCard, SIZE, CONTENT_TYPE } from './og-card';

/**
 * Default Twitter card image — served at `/twitter-image`. Same branded card as
 * the Open Graph image (1200×630 works for `summary_large_image`). Next wires it
 * into `<meta name="twitter:image">` automatically, complementing the root
 * metadata's `twitter` block. Uses the Twitter-specific localized strings.
 */
export const alt = 'ruletka.top — видео и голосовая рулетка';
export const size = SIZE;
export const contentType = CONTENT_TYPE;

export default async function TwitterImage() {
  const t = await getTranslations('metadata');
  return renderOgCard(t('twitterTitle'), t('twitterDescription'));
}
