import type { ReactNode } from 'react';

/**
 * Route-group layout for the legal/info pages (/rules, /privacy, /help,
 * /about). Each page composes the rich {@link LegalLayout} client shell
 * (atmospheric hero + sticky TOC + prose) itself, since the TOC and headings are
 * page-specific; this group layout is a thin server wrapper that exists as the
 * single mount point for any future cross-page chrome (e.g. a shared
 * legal sub-nav or print stylesheet) and keeps the four pages grouped.
 */
export default function LegalGroupLayout({ children }: { children: ReactNode }) {
  return children;
}
