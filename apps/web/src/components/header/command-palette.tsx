'use client';

/**
 * ⌘K command palette — a modern "spotlight" launcher for the whole app.
 *
 * • Opens on ⌘K / Ctrl+K from anywhere, or via the header search button (which
 *   dispatches a `ruletka:command-open` event so any surface can trigger it).
 * • Built on the design-system `Dialog` (Radix) → real focus trap, scroll lock,
 *   `Esc` to close, and an a11y title/description contract.
 * • Full keyboard control inside: ↑/↓ to move, Enter to navigate, type to
 *   filter. The active option is tracked with `aria-activedescendant` on a
 *   `role="combobox"` input over a `role="listbox"`.
 * • Filters {@link COMMAND_ITEMS} over label + description + keywords.
 *
 * Pure client navigation (no data fetching), so it's instant and bundle-cheap.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, CornerDownLeft, Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@ruletka/ui';
import { COMMAND_ITEMS, type NavItem } from '@/config/nav';
import { cn } from '@/lib/cn';

/** Event other components dispatch to open the palette imperatively. */
export const COMMAND_OPEN_EVENT = 'ruletka:command-open';

/** Imperatively open the palette from anywhere on the client. */
export function openCommandPalette(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(COMMAND_OPEN_EVENT));
}

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

/**
 * Score a nav item against a query; `false` means "no match".
 *
 * The haystack uses the LOCALIZED label + description (so search works in the
 * active language) plus the item's raw `keywords` aliases (kept untranslated on
 * purpose — they let users find a page by a word that isn't in its label).
 */
function matches(item: NavItem, q: string, label: string, description: string): boolean {
  if (!q) return true;
  const haystack = [label, description, ...(item.keywords ?? [])].join(' ').toLowerCase();
  // Every whitespace-separated term must appear somewhere (AND search).
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

export function CommandPalette() {
  const router = useRouter();
  const t = useTranslations('chrome');
  const tn = useTranslations('nav');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const q = normalize(query);
    return COMMAND_ITEMS.filter((item) =>
      matches(item, q, tn(`${item.key}.label`), tn(`${item.key}.description`)),
    );
  }, [query, tn]);

  // Keep the highlighted row in range as results shrink/grow.
  useEffect(() => {
    setActiveIndex((i) => (results.length === 0 ? 0 : Math.min(i, results.length - 1)));
  }, [results.length]);

  // Reset transient state whenever the palette closes.
  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  // Global ⌘K / Ctrl+K + imperative open event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(COMMAND_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(COMMAND_OPEN_EVENT, onOpen);
    };
  }, []);

  const go = useCallback(
    (item: NavItem | undefined) => {
      if (!item) return;
      setOpen(false);
      router.push(item.href);
    },
    [router],
  );

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(results[activeIndex]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(Math.max(0, results.length - 1));
    }
  };

  // Scroll the active option into view as the user arrows through.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const optionId = (i: number) => `${listboxId}-opt-${i}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        hideClose
        // Override the centered-modal defaults: dock near the top, widen, drop
        // the inner padding (the input + list own their spacing).
        className="top-[12vh] max-w-xl translate-y-0 overflow-hidden p-0 sm:top-[14vh]"
        // Let the input keep focus on open instead of the dialog container.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{t('commandPalette.title')}</DialogTitle>
        <DialogDescription className="sr-only">
          {t('commandPalette.description')}
        </DialogDescription>

        {/* Search input row */}
        <div className="flex items-center gap-3 border-b border-border/70 px-4">
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            autoFocus
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={results.length ? optionId(activeIndex) : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={t('commandPalette.placeholder')}
            className="h-14 w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <kbd className="hidden shrink-0 rounded-md border border-border/70 bg-card/50 px-1.5 py-0.5 text-[0.65rem] font-medium text-muted-foreground sm:inline-block">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={t('commandPalette.listAria')}
          className="max-h-[min(22rem,60vh)] overflow-y-auto p-2"
        >
          {results.length === 0 ? (
            <li className="px-3 py-10 text-center text-sm text-muted-foreground">
              {t('commandPalette.empty')}{' '}
              <span className="font-medium text-foreground">«{query}»</span>
            </li>
          ) : (
            results.map((item, i) => {
              const Icon = item.icon;
              const active = i === activeIndex;
              return (
                <li key={item.key} role="presentation">
                  <button
                    type="button"
                    id={optionId(i)}
                    role="option"
                    aria-selected={active}
                    data-index={i}
                    onClick={() => go(item)}
                    onMouseMove={() => setActiveIndex(i)}
                    className={cn(
                      'group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors',
                      active ? 'bg-accent-soft text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors',
                        active
                          ? 'border-border/70 bg-card/70 text-foreground'
                          : 'border-border/50 bg-card/30',
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium text-foreground">
                        {tn(`${item.key}.label`)}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {tn(`${item.key}.description`)}
                      </span>
                    </span>
                    <ArrowRight
                      className={cn(
                        'ml-auto h-4 w-4 shrink-0 transition-all',
                        active
                          ? 'translate-x-0 text-foreground opacity-100'
                          : '-translate-x-1 opacity-0',
                      )}
                      aria-hidden="true"
                    />
                  </button>
                </li>
              );
            })
          )}
        </ul>

        {/* Footer hint */}
        <div className="flex items-center justify-between border-t border-border/70 px-4 py-2.5 text-[0.7rem] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <kbd className="rounded border border-border/70 bg-card/50 px-1 py-0.5">↑</kbd>
            <kbd className="rounded border border-border/70 bg-card/50 px-1 py-0.5">↓</kbd>
            {t('commandPalette.hintNavigate')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <kbd className="inline-flex items-center gap-1 rounded border border-border/70 bg-card/50 px-1 py-0.5">
              <CornerDownLeft className="h-3 w-3" aria-hidden="true" />
            </kbd>
            {t('commandPalette.hintGo')}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
