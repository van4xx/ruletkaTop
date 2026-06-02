import type { ReactNode } from 'react';

/**
 * Shared atmospheric wrapper for all profile routes — keeps the neon-glow
 * background and max-width container consistent across public/own profiles.
 * A plain server component (no interactivity).
 */
export function ProfilePageShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--color-neon-violet)_0%,transparent_60%)] opacity-[0.18] blur-3xl" />
        <div className="absolute -right-24 top-40 h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-magenta)_0%,transparent_60%)] opacity-[0.14] blur-3xl" />
        <div className="absolute -left-24 top-72 h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-cyan)_0%,transparent_60%)] opacity-[0.12] blur-3xl" />
      </div>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">{children}</div>
    </div>
  );
}
