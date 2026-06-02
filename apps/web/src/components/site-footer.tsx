/**
 * Site footer — lightweight, server-rendered. Mirrors the primary routes plus
 * the legal/info links. Fully localized via next-intl (`footer` + `nav`
 * namespaces); resolved server-side with `getTranslations`.
 */
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { NAV_ITEMS, ROUTES } from '@/config/nav';

const YEAR = new Date().getFullYear();

export async function SiteFooter() {
  const t = await getTranslations();

  return (
    <footer className="relative mt-24 border-t border-border/60">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr] lg:px-8">
        <div className="space-y-3">
          <p className="font-display text-lg font-bold">
            ruletka<span className="text-gradient-neon">.top</span>
          </p>
          <p className="max-w-xs text-sm text-muted-foreground">{t('footer.description')}</p>
        </div>

        <nav aria-label={t('footer.sections')} className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t('footer.sections')}
          </h2>
          <ul className="space-y-2 text-sm">
            {NAV_ITEMS.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  {t(`nav.${item.key}.label`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label={t('footer.info')} className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t('footer.info')}
          </h2>
          <ul className="space-y-2 text-sm">
            <li>
              <Link
                href={ROUTES.about}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {t('footer.links.about')}
              </Link>
            </li>
            <li>
              <Link
                href={ROUTES.rules}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {t('footer.links.rules')}
              </Link>
            </li>
            <li>
              <Link
                href={ROUTES.privacy}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {t('footer.links.privacy')}
              </Link>
            </li>
            <li>
              <Link
                href={ROUTES.help}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {t('footer.links.help')}
              </Link>
            </li>
          </ul>
        </nav>
      </div>

      <div className="border-t border-border/60">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:px-6 lg:px-8">
          <p>{t('footer.copyright', { year: YEAR })}</p>
          <p>{t('footer.ageNotice')}</p>
        </div>
      </div>
    </footer>
  );
}
