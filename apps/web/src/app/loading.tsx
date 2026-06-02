import { Skeleton, Spinner } from '@ruletka/ui';

/**
 * Global route-transition fallback (App Router `loading.tsx`). A tasteful,
 * on-brand skeleton that echoes the typical page layout (atmospheric glow +
 * hero header + content cards) so navigations feel instantaneous and never flash
 * blank. Purely presentational and accessible (announced as busy).
 */
export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="relative min-h-[calc(100dvh-4rem)] overflow-hidden"
    >
      <span className="sr-only">Загрузка…</span>

      {/* Atmospheric background, matching the page shells. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-48 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,var(--color-neon-violet)_0%,transparent_60%)] opacity-[0.16] blur-3xl" />
        <div className="absolute -right-28 top-24 h-[26rem] w-[26rem] rounded-full bg-[radial-gradient(circle,var(--color-neon-cyan)_0%,transparent_60%)] opacity-[0.1] blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-4 pb-20 pt-12 sm:px-6 sm:pt-16 lg:px-8">
        {/* Centered live spinner for an immediate signal of activity. */}
        <div className="mb-10 flex items-center gap-3 text-muted-foreground" aria-hidden="true">
          <Spinner size="sm" role="presentation" label="" />
          <span className="text-sm">Загружаем…</span>
        </div>

        {/* Header skeleton */}
        <div className="max-w-2xl space-y-4" aria-hidden="true">
          <Skeleton className="h-7 w-32 rounded-full" />
          <Skeleton className="h-12 w-3/4 rounded-2xl" />
          <Skeleton className="h-5 w-full max-w-xl" />
          <Skeleton className="h-5 w-2/3" />
        </div>

        {/* Card grid skeleton */}
        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass-panel rounded-2xl p-6">
              <Skeleton className="h-12 w-12 rounded-xl" />
              <Skeleton className="mt-5 h-6 w-2/3" />
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-4/5" />
              <Skeleton className="mt-6 h-11 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
