/**
 * Layout for the roulette route group (/video, /voice).
 *
 * The roulette is an immersive, full-bleed experience, so this layout keeps the
 * shared site chrome (header/footer come from the root layout) but renders a
 * minimal wrapper that lets the stage own the viewport.
 *
 * The toast region is now mounted globally in `app/providers.tsx` (a single
 * app-wide <Toaster/>), so this group no longer mounts its own — that avoids a
 * duplicate toast stack while keeping /video and /voice toasts working.
 */
import type { ReactNode } from 'react';

export default function RouletteLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
