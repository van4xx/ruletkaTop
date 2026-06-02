import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { Compass, Home, Video } from 'lucide-react';
import { Button } from '@ruletka/ui';
import { SystemScreen } from '@/components/system/system-screen';
import { ROUTES } from '@/config/nav';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('misc');
  return {
    title: t('system.notFoundMetaTitle'),
    robots: { index: false, follow: false },
  };
}

/**
 * Global 404 — a branded, atmospheric "lost in the void" screen with clear
 * routes back into the product. Rendered by Next.js for unmatched paths and
 * explicit `notFound()` calls.
 */
export default function NotFound() {
  const t = useTranslations('misc');
  return (
    <SystemScreen
      code="404"
      icon={<Compass className="h-8 w-8" aria-hidden="true" />}
      title={t('system.notFoundTitle')}
      description={t('system.notFoundDesc')}
      actions={
        <>
          <Button asChild size="lg" leadingIcon={<Home className="h-5 w-5" />}>
            <Link href={ROUTES.home}>{t('system.goHome')}</Link>
          </Button>
          <Button asChild variant="outline" size="lg" leadingIcon={<Video className="h-5 w-5" />}>
            <Link href={ROUTES.video}>{t('system.openRoulette')}</Link>
          </Button>
        </>
      }
    />
  );
}
