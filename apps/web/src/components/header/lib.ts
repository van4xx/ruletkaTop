/**
 * Shared header helpers.
 */
import { ROUTES } from '@/config/nav';

/** True when `pathname` is within the section that `href` represents. */
export function isRouteActive(pathname: string, href: string): boolean {
  if (href === ROUTES.home) return pathname === ROUTES.home;
  if (href === ROUTES.dashboard) return pathname === ROUTES.dashboard;
  // `/friends` should NOT light up for `/friends/requests` only when an exact
  // match is desired; here section-prefix matching is the right behaviour for
  // the primary nav (a sub-route still belongs to its parent section).
  return pathname === href || pathname.startsWith(`${href}/`);
}
