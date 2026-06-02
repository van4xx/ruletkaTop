import type { Metadata } from 'next';
import Link from 'next/link';
import { Compass, Home, Video } from 'lucide-react';
import { Button } from '@ruletka/ui';
import { SystemScreen } from '@/components/system/system-screen';
import { ROUTES } from '@/config/nav';

export const metadata: Metadata = {
  title: 'Страница не найдена',
  robots: { index: false, follow: false },
};

/**
 * Global 404 — a branded, atmospheric "lost in the void" screen with clear
 * routes back into the product. Rendered by Next.js for unmatched paths and
 * explicit `notFound()` calls.
 */
export default function NotFound() {
  return (
    <SystemScreen
      code="404"
      icon={<Compass className="h-8 w-8" aria-hidden="true" />}
      title="Кажется, вы свернули не туда"
      description="Страница не найдена или была перемещена. Но в эфире всегда есть кто-то новый — вернёмся к общению?"
      actions={
        <>
          <Button asChild size="lg" leadingIcon={<Home className="h-5 w-5" />}>
            <Link href={ROUTES.home}>На главную</Link>
          </Button>
          <Button asChild variant="outline" size="lg" leadingIcon={<Video className="h-5 w-5" />}>
            <Link href={ROUTES.video}>Открыть рулетку</Link>
          </Button>
        </>
      }
    />
  );
}
