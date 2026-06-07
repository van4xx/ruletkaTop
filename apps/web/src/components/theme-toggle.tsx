'use client';

/**
 * Theme toggle — intentionally renders nothing (the product ships dark-only).
 *
 * ruletka.top has a single, hand-tuned dark "neon void" theme. A light theme
 * was never actually designed: no `dark:`/`light:` variants exist anywhere in
 * the app, every surface (aurora glows, glass fills, neon shadows) is tuned
 * against the dark canvas, so a light render washes out and loses contrast.
 * Accordingly `providers.tsx` sets `forcedTheme="dark"`, and exposing a toggle
 * to a broken light mode would be worse than offering none.
 *
 * This component is kept as the stable seam: when a real light theme is built,
 * restore the cycling button body (git history) and drop `forcedTheme`. Until
 * then every render site (header, mobile drawer) gets nothing.
 */
export function ThemeToggle(props: { className?: string }) {
  void props;
  return null;
}
