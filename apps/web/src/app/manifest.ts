import type { MetadataRoute } from 'next';
import { getTranslations } from 'next-intl/server';

/**
 * PWA web app manifest — served at `/manifest.webmanifest` and declared from the
 * root metadata. Makes the app installable (standalone display) with the brand
 * void/neon theming and generated icons (192 / 512 / maskable, produced by the
 * sibling `icon-*` routes via `ImageResponse` — no binary asset shipped).
 *
 * Copy is localized via the same `metadata` namespace as the document title.
 * Crawlers / install prompts don't send the locale cookie, so this renders the
 * default (ru) name — the right default for the Russian-first product.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations('metadata');
  return {
    name: t('titleDefault'),
    short_name: 'ruletka.top',
    description: t('description'),
    start_url: '/',
    display: 'standalone',
    background_color: '#0a0a0f',
    theme_color: '#0a0a0f',
    icons: [
      { src: '/icon-192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
