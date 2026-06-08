import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names with conflict resolution.
 *
 * Combines {@link https://github.com/lukeed/clsx | clsx} (conditional class
 * composition) with {@link https://github.com/dcastil/tailwind-merge | tailwind-merge}
 * (last-wins resolution of conflicting Tailwind utilities). Use it everywhere a
 * component accepts a `className` so callers can override defaults safely:
 *
 * ```tsx
 * <div className={cn('px-3 py-2 text-sm', isActive && 'text-accent', className)} />
 * ```
 *
 * Critically this lets a caller-supplied `hidden` win over a component's
 * hard-coded `inline-flex` (naive concatenation kept both, leaking utility
 * clusters onto small screens and causing site-wide horizontal scroll). It
 * mirrors the design-system `cn` in `@ruletka/ui` so behaviour is identical
 * across the shell and its primitives.
 */
export type { ClassValue };

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
