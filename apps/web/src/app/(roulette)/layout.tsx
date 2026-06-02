/**
 * Layout for the roulette route group (/video, /voice).
 *
 * The roulette is an immersive, full-bleed experience, so this layout keeps the
 * shared site chrome (header/footer come from the root layout) but renders a
 * minimal wrapper that lets the stage own the viewport.
 *
 * NOTE FOR INTEGRATOR: a global <Toaster/> is NOT currently mounted in
 * `app/providers.tsx`. We mount one here so /video and /voice toasts (gift sent,
 * friend request, errors) work standalone. If you add a global Toaster to the
 * provider tree, REMOVE the one below to avoid a duplicate toast stack.
 */
import type { ReactNode } from 'react';
import { Toaster } from '@ruletka/ui';

export default function RouletteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster />
    </>
  );
}
