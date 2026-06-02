'use client';

/**
 * Desktop search trigger — a faux input that opens the ⌘K command palette.
 *
 * Renders as a button (not an input) so it never steals focus or fires network
 * requests; it advertises the keyboard shortcut and matches the platform
 * (⌘ on macOS, Ctrl elsewhere). Memoised — it has no props that change.
 */
import { memo, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { openCommandPalette } from './command-palette';

function SearchTriggerImpl({ className }: { className?: string }) {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    // navigator.platform is deprecated but still the most reliable quick check;
    // fall back to userAgent. Only affects the hint glyph, never behaviour.
    const ua = navigator.userAgent;
    setIsMac(/Mac|iPhone|iPad|iPod/.test(navigator.platform) || /Mac OS X/.test(ua));
  }, []);

  return (
    <button
      type="button"
      onClick={openCommandPalette}
      aria-label="Поиск — открыть командную панель"
      aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
      className={cn(
        'group inline-flex items-center gap-2 rounded-full py-2 pl-3 pr-2 text-sm',
        'border border-border/70 bg-card/30 text-muted-foreground backdrop-blur',
        'outline-none transition-colors hover:bg-card/60 hover:text-foreground',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
    >
      <Search className="h-4 w-4" aria-hidden="true" />
      <span className="hidden xl:inline">Поиск</span>
      <kbd
        aria-hidden="true"
        className="ml-1 hidden items-center gap-0.5 rounded-md border border-border/70 bg-background/60 px-1.5 py-0.5 text-[0.65rem] font-medium tabular-nums xl:inline-flex"
      >
        {isMac ? '⌘' : 'Ctrl'}K
      </kbd>
    </button>
  );
}

export const SearchTrigger = memo(SearchTriggerImpl);
