'use client';

import { Skeleton } from '@ruletka/ui';
import { cn } from '@/lib/cn';

/** Inbox loading placeholder. */
export function ConversationsSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <ul className="space-y-1" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 p-3">
          <Skeleton shape="circle" className="h-14 w-14 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-10" />
            </div>
            <Skeleton className="h-3 w-44" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Thread loading placeholder — alternating inbound/outbound bubbles. */
export function ThreadSkeleton() {
  const widths = ['w-40', 'w-56', 'w-32', 'w-48', 'w-24', 'w-52'];
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3 py-2" aria-hidden="true">
      {widths.map((w, i) => (
        <div key={i} className={cn('flex', i % 2 === 0 ? 'justify-start' : 'justify-end')}>
          <Skeleton shape="block" className={cn('h-10 rounded-2xl', w)} />
        </div>
      ))}
    </div>
  );
}
