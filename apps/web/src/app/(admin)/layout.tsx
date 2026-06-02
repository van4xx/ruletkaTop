/**
 * Layout for the admin route group (/moderation).
 *
 * Inherits the shared site chrome (header/footer) from the root layout; this
 * wrapper only adds a <Toaster/> so the moderation queue's uphold/dismiss
 * toasts surface when the page is visited standalone.
 *
 * NOTE FOR INTEGRATOR: as with `app/(roulette)/layout.tsx`, a global <Toaster/>
 * is NOT currently mounted in `app/providers.tsx`. If you add one there, REMOVE
 * the Toaster below to avoid a duplicate toast stack.
 */
import type { ReactNode } from 'react';
import { Toaster } from '@ruletka/ui';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster />
    </>
  );
}
