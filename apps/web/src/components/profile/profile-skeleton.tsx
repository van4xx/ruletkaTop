'use client';

import { Skeleton } from '@ruletka/ui';

/** Loading placeholder for a profile page — mirrors hero + stats + tabs layout. */
export function ProfileSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Загрузка профиля">
      {/* Hero */}
      <div className="glass-panel overflow-hidden rounded-3xl">
        <Skeleton shape="block" className="h-32 rounded-none sm:h-44" />
        <div className="px-5 pb-6 sm:px-8">
          <div className="-mt-14 flex items-end gap-4 sm:-mt-16">
            <Skeleton shape="circle" className="size-24 ring-4 ring-background sm:size-28" />
            <div className="mb-2 space-y-2.5">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-5 w-32" />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-24 rounded-full" />
            ))}
          </div>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} shape="block" className="h-20 rounded-2xl" />
        ))}
      </div>

      {/* Tabs + panel */}
      <div className="space-y-4">
        <Skeleton className="h-11 w-full rounded-xl" />
        <div className="glass-panel rounded-3xl p-6">
          <Skeleton className="mb-4 h-5 w-40" />
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} shape="block" className="aspect-square rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
