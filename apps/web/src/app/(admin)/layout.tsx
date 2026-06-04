/**
 * Layout for the admin route group (/moderation).
 *
 * Inherits the shared site chrome (header/footer) from the root layout. The
 * toast region is now mounted globally in `app/providers.tsx` (a single app-wide
 * <Toaster/>), so this group no longer mounts its own — that avoids a duplicate
 * toast stack while keeping the moderation queue's uphold/dismiss toasts working.
 */
import type { ReactNode } from 'react';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
