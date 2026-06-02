'use client';

/**
 * Primary application header.
 * ───────────────────────────────────────────────────────────────────────────
 * Premium, minimal, scroll-aware. The owner's brief: "incredibly cool", FAST,
 * and with NO redundant links.
 *
 * Layout
 *   • Left  — auth-aware brand mark (→ /dashboard when signed in, → / when not).
 *   • Center — a deliberately tiny primary nav (Рулетка / Друзья / Топ) with a
 *     single gliding active-route pill (framer-motion `layoutId`). Everything
 *     else lives in the ⌘K palette + the avatar menu.
 *   • Right — ⌘K search launcher, notifications bell (live unread badge), coin
 *     pill (+ to top up), theme toggle, and the avatar dropdown — OR, for
 *     anonymous visitors, «Войти» / «Регистрация».
 *
 * Scroll-awareness
 *   Past a small threshold the bar condenses (h-16 → h-14), deepens its glass
 *   blur and gains a hairline + shadow. The transition is GPU-friendly (height,
 *   backdrop, shadow) and the inner nav is memoised so scrolling never triggers
 *   a nav re-render — only the shell's `scrolled` boolean changes.
 *
 * a11y
 *   `aria-current` on the active link, `aria-expanded`/`aria-haspopup` on the
 *   menus, full keyboard navigation, visible focus rings, and `prefers-reduced-
 *   motion` honoured by every animated child.
 */
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuth } from '@/features/auth';
import { useCoinBalance } from '@/hooks/wallet/use-wallet';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageSwitcher } from '@/components/language-switcher';
import {
  AuthCta,
  BrandMark,
  CoinPill,
  CommandPalette,
  DesktopNav,
  MobileDrawer,
  NotificationsBell,
  SearchTrigger,
  UserMenu,
  useScrolled,
} from '@/components/header';

export function SiteHeader() {
  const pathname = usePathname();
  const t = useTranslations('common');
  const scrolled = useScrolled(8);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  const { user, isAuthenticated, isReady, logout } = useAuth();
  const balance = useCoinBalance();

  // Close the drawer on route change (covers in-drawer link clicks too).
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <>
      {/* The ⌘K command palette listens globally; mounted once, near the top. */}
      <CommandPalette />

      <header className="sticky top-0 z-50 w-full">
        <div
          className={cn(
            'border-x-0 border-t-0 transition-[background-color,backdrop-filter,box-shadow,border-color] duration-300',
            scrolled
              ? 'border-b border-border/70 bg-card/55 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.45)] backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-card/45'
              : 'border-b border-transparent bg-background/30 backdrop-blur-md',
          )}
        >
          <div
            className={cn(
              'mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 transition-[height] duration-300 sm:px-6 lg:px-8',
              scrolled ? 'h-14' : 'h-16',
            )}
          >
            {/* Left: brand + primary nav */}
            <div className="flex items-center gap-6">
              <BrandMark />
              <DesktopNav pathname={pathname} />
            </div>

            {/* Right: utilities */}
            <div className="flex items-center gap-2">
              <SearchTrigger className="hidden sm:inline-flex" />

              {isReady && isAuthenticated && user ? (
                <>
                  <NotificationsBell />
                  <CoinPill balance={balance} className="hidden sm:inline-flex" />
                  <LanguageSwitcher className="hidden sm:inline-flex" />
                  <ThemeToggle className="hidden sm:inline-flex" />
                  <div className="hidden sm:block">
                    <UserMenu user={user} onLogout={logout} />
                  </div>
                </>
              ) : isReady ? (
                <>
                  <LanguageSwitcher className="hidden sm:inline-flex" />
                  <ThemeToggle className="hidden sm:inline-flex" />
                  <AuthCta className="hidden sm:flex" />
                </>
              ) : (
                // Pre-hydration: a stable placeholder matching the control box so
                // there is zero layout shift once auth state settles.
                <span
                  aria-hidden="true"
                  className="hidden h-9 w-9 rounded-full border border-border/70 bg-card/30 sm:block"
                />
              )}

              {/* Mobile menu trigger */}
              <button
                ref={menuButtonRef}
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-expanded={drawerOpen}
                aria-haspopup="dialog"
                aria-label={t('openMenu')}
                className={cn(
                  'inline-flex h-9 w-9 items-center justify-center rounded-full lg:hidden',
                  'border border-border/70 bg-card/40 text-muted-foreground backdrop-blur',
                  'outline-none transition-colors hover:bg-card/70 hover:text-foreground',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                )}
              >
                <Menu className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        pathname={pathname}
        isAuthenticated={isReady && isAuthenticated}
        user={user}
        onLogout={logout}
        returnFocusRef={menuButtonRef}
      />
    </>
  );
}
