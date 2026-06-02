import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names with conflict resolution.
 *
 * Combines {@link https://github.com/lukeed/clsx | clsx} (conditional class
 * composition) with {@link https://github.com/dcastil/tailwind-merge | tailwind-merge}
 * (last-wins resolution of conflicting Tailwind utilities). Use it everywhere
 * a component accepts a `className` so callers can override defaults safely:
 *
 * ```tsx
 * <div className={cn('px-3 py-2 text-sm', isActive && 'text-accent', className)} />
 * ```
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
