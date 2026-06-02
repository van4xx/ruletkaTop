/**
 * Minimal, dependency-free className combiner.
 *
 * Accepts strings, falsy values and string→boolean maps, returning a single
 * space-separated class string. Intentionally light: the design-system package
 * (`@ruletka/ui`) owns the richer `cn` with tailwind-merge for its primitives;
 * the shell only needs conditional concatenation.
 */
export type ClassValue = string | number | false | null | undefined | Record<string, boolean>;

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  for (const input of inputs) {
    if (!input) continue;
    if (typeof input === 'string' || typeof input === 'number') {
      out.push(String(input));
    } else {
      for (const [key, value] of Object.entries(input)) {
        if (value) out.push(key);
      }
    }
  }
  return out.join(' ');
}
