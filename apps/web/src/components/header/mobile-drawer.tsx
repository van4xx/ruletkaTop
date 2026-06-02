'use client';

/**
 * Mobile navigation drawer — a slide-in panel for small screens.
 *
 * • Backdrop fade + panel slide (framer-motion, reduced-motion aware).
 * • Focus trap: focus moves into the panel on open, cycles within it (Tab /
 *   Shift+Tab), and returns to the trigger on close.
 * • `Escape` closes; backdrop click closes; body scroll is locked while open.
 * • Renders the fuller {@link MOBILE_NAV} for authed users, plus the search
 *   launcher, theme toggle and either the user identity + sign-out or the
 *   anonymous CTAs.
 *
 * Rendered into a portal so it overlays everything regardless of header stacking.
 */
import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Crown, LogOut, Search, X } from 'lucide-react';
import type { AuthUser } from '@ruletka/shared-types';
import { Avatar } from '@ruletka/ui';
import { MOBILE_NAV, PRIMARY_NAV } from '@/config/nav';
import { cn } from '@/lib/cn';
import { ThemeToggle } from '@/components/theme-toggle';
import { isRouteActive } from './lib';
import { AuthCta } from './auth-cta';
import { openCommandPalette } from './command-palette';

const FOCUSABLE = 'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])';

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  pathname: string;
  isAuthenticated: boolean;
  user: AuthUser | null;
  onLogout: () => Promise<void>;
  /** The trigger button to return focus to on close. */
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
}

export function MobileDrawer({
  open,
  onClose,
  pathname,
  isAuthenticated,
  user,
  onLogout,
  returnFocusRef,
}: MobileDrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const reduceMotion = useReducedMotion();
  const t = useTranslations('chrome');
  const tc = useTranslations('common');
  const tn = useTranslations('nav');

  // Authed users get the full taxonomy; anon users only the public few.
  const items = isAuthenticated ? MOBILE_NAV : PRIMARY_NAV;

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Escape to close + focus trap. Bound only while open.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      );
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // Move focus into the panel on open; restore to the trigger on close.
  useEffect(() => {
    if (open) {
      // Defer to allow the panel to mount.
      const id = window.setTimeout(() => {
        const panel = panelRef.current;
        const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE);
        firstFocusable?.focus();
      }, 30);
      return () => window.clearTimeout(id);
    }
    returnFocusRef.current?.focus();
    return undefined;
  }, [open, returnFocusRef]);

  const handleLogout = useCallback(async () => {
    onClose();
    await onLogout();
  }, [onClose, onLogout]);

  const handleSearch = useCallback(() => {
    onClose();
    // Defer so the drawer's unmount doesn't fight the palette's focus.
    window.setTimeout(openCommandPalette, 60);
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[var(--z-overlay,1000)] lg:hidden" role="presentation">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 bg-background/70 backdrop-blur-md"
            aria-hidden="true"
          />

          {/* Panel */}
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('drawer.navAria')}
            initial={reduceMotion ? { opacity: 0 } : { x: '100%' }}
            animate={reduceMotion ? { opacity: 1 } : { x: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { x: '100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 38, mass: 0.9 }}
            className={cn(
              'absolute inset-y-0 right-0 flex w-[min(20rem,85vw)] flex-col',
              'glass-panel border-y-0 border-r-0 shadow-2xl',
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3.5">
              <span className="font-display text-base font-bold">
                ruletka<span className="text-gradient-neon">.top</span>
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('drawer.closeAria')}
                className={cn(
                  'inline-flex h-9 w-9 items-center justify-center rounded-full',
                  'border border-border/70 bg-card/40 text-muted-foreground',
                  'outline-none transition-colors hover:bg-card/70 hover:text-foreground',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                )}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Identity (authed) */}
            {isAuthenticated && user && (
              <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
                <Avatar
                  size="md"
                  alt={user.nickname}
                  ring={user.isPremium ? 'aurora' : 'none'}
                  status="online"
                />
                <div className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{user.nickname}</span>
                    {user.isPremium && (
                      <Crown
                        className="h-3.5 w-3.5 shrink-0 text-warning"
                        aria-label={t('drawer.premiumAria')}
                      />
                    )}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                </div>
              </div>
            )}

            {/* Search launcher */}
            <div className="px-3 pt-3">
              <button
                type="button"
                onClick={handleSearch}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm',
                  'border border-border/70 bg-card/30 text-muted-foreground',
                  'outline-none transition-colors hover:bg-card/60 hover:text-foreground',
                  'focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <Search className="h-4 w-4" aria-hidden="true" />
                {t('drawer.searchSections')}
              </button>
            </div>

            {/* Nav */}
            <nav
              aria-label={t('drawer.mobileNavAria')}
              className="flex-1 overflow-y-auto px-3 py-3"
            >
              <ul className="flex flex-col gap-1">
                {items.map((item) => {
                  const active = isRouteActive(pathname, item.href);
                  const Icon = item.icon;
                  return (
                    <li key={item.key}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-3 rounded-xl px-3 py-3 text-base font-medium outline-none transition-colors',
                          'focus-visible:ring-2 focus-visible:ring-ring',
                          active
                            ? 'bg-primary/12 text-foreground'
                            : 'text-muted-foreground hover:bg-card/70 hover:text-foreground',
                        )}
                      >
                        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                        <span className="flex min-w-0 flex-col">
                          <span>{tn(`${item.key}.label`)}</span>
                          <span className="truncate text-xs font-normal text-muted-foreground">
                            {tn(`${item.key}.description`)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            {/* Footer actions */}
            <div className="border-t border-border/60 px-3 py-3">
              {isAuthenticated ? (
                <div className="flex items-center justify-between gap-2">
                  <ThemeToggle />
                  <button
                    type="button"
                    onClick={handleLogout}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium',
                      'text-danger outline-none transition-colors hover:bg-danger/10',
                      'focus-visible:ring-2 focus-visible:ring-ring',
                    )}
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    {tc('logout')}
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <ThemeToggle />
                  <AuthCta />
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
