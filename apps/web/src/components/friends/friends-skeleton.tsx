'use client';

import { Skeleton } from '@ruletka/ui';

/** Loading placeholder mirroring the friend-card layout. */
export function FriendsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="glass-panel flex items-center gap-4 rounded-2xl p-4">
          <Skeleton shape="circle" className="h-14 w-14 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton shape="block" className="h-9 w-16" />
          <Skeleton shape="circle" className="h-9 w-9" />
        </li>
      ))}
    </ul>
  );
}
