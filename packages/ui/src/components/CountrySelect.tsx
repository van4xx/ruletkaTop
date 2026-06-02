'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, ChevronDown, Globe, Search, X } from 'lucide-react';
import * as React from 'react';

import type { CountryCode } from '@ruletka/shared-types';

import { cn } from '../lib/cn';
import { COUNTRIES, COUNTRY_BY_CODE, type Country, codeToFlag } from '../lib/countries';
import { Badge } from './Badge';

export interface CountrySelectProps {
  /** Selected ISO alpha-2 codes (controlled). */
  value: CountryCode[];
  /** Called with the next selection whenever it changes. */
  onChange: (value: CountryCode[]) => void;
  /** Country list to choose from. Defaults to the bundled {@link COUNTRIES}. */
  countries?: readonly Country[];
  /** Placeholder shown when nothing is selected. */
  placeholder?: string;
  /** Cap the number of selectable countries. */
  maxSelections?: number;
  /** Disable the whole control. */
  disabled?: boolean;
  /** Accessible label for the trigger (when no visible label is present). */
  'aria-label'?: string;
  className?: string;
  id?: string;
}

/**
 * A searchable, multi-select country picker with flag emojis — used by
 * matchmaking filters and profile settings. Selections render as removable
 * chips on the trigger; the panel is a searchable, keyboard-navigable listbox.
 *
 * Accessibility: the trigger is a `combobox` (aria-expanded/controls), the list
 * is a `listbox` with `option` rows and `aria-selected`. Arrow keys move the
 * active option, Enter toggles it, Escape closes, and focus returns to the
 * trigger on close. Outside-click and `Escape` both dismiss the panel.
 */
export function CountrySelect({
  value,
  onChange,
  countries = COUNTRIES,
  placeholder = 'Select countries',
  maxSelections,
  disabled = false,
  className,
  id,
  ...aria
}: CountrySelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);

  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const reduceMotion = useReducedMotion();
  const listboxId = React.useId();

  const selectedSet = React.useMemo(() => new Set(value), [value]);
  const atLimit = maxSelections != null && value.length >= maxSelections;

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    );
  }, [countries, query]);

  // Close on outside click.
  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Focus the search field when opening; reset query when closing.
  React.useEffect(() => {
    if (open) {
      setActiveIndex(0);
      const raf = requestAnimationFrame(() => searchRef.current?.focus());
      return () => cancelAnimationFrame(raf);
    }
    setQuery('');
    return undefined;
  }, [open]);

  // Keep the active option scrolled into view.
  React.useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  function toggle(code: CountryCode) {
    if (selectedSet.has(code)) {
      onChange(value.filter((c) => c !== code));
    } else {
      if (atLimit) return;
      onChange([...value, code]);
    }
  }

  function remove(code: CountryCode) {
    onChange(value.filter((c) => c !== code));
  }

  function onKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Enter': {
        event.preventDefault();
        const country = filtered[activeIndex];
        if (country) toggle(country.code);
        break;
      }
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(filtered.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div ref={rootRef} className={cn('relative w-full', className)}>
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-label={aria['aria-label']}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex min-h-11 w-full items-center gap-2 rounded-xl border border-border bg-input/40 px-3 py-1.5 text-left text-sm',
          'transition-[border-color,box-shadow,background-color] duration-[var(--duration-fast)] ease-[var(--ease-out-quart)]',
          'hover:border-border-strong',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-focus',
          open && 'border-accent-muted ring-2 ring-input-focus',
          disabled && 'cursor-not-allowed opacity-55',
        )}
      >
        <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="flex flex-1 flex-wrap items-center gap-1.5">
          {value.length === 0 ? (
            <span className="text-subtle-foreground">{placeholder}</span>
          ) : (
            value.map((code) => {
              const country = COUNTRY_BY_CODE.get(code);
              return (
                <Badge key={code} variant="neutral" size="sm" className="gap-1 pr-1">
                  <span aria-hidden="true">{codeToFlag(code)}</span>
                  <span>{country?.name ?? code}</span>
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={`Remove ${country?.name ?? code}`}
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      remove(code);
                    }}
                    className="ml-0.5 inline-flex rounded-full p-0.5 text-muted-foreground hover:bg-glass hover:text-foreground"
                  >
                    <X className="size-3" />
                  </span>
                </Badge>
              );
            })
          )}
        </span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform duration-[var(--duration-fast)]',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      {/* Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.25, 1, 0.5, 1] }}
            className="absolute z-[var(--z-overlay)] mt-2 w-full origin-top overflow-hidden rounded-xl glass-strong shadow-lg"
            onKeyDown={onKeyDown}
          >
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                placeholder="Search countries…"
                aria-label="Search countries"
                aria-controls={listboxId}
                aria-activedescendant={
                  filtered[activeIndex] ? `${listboxId}-${filtered[activeIndex].code}` : undefined
                }
                className="h-11 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground"
              />
              {maxSelections != null && (
                <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">
                  {value.length}/{maxSelections}
                </span>
              )}
            </div>

            <ul
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-multiselectable="true"
              aria-label="Countries"
              className="max-h-64 overflow-y-auto p-1.5"
            >
              {filtered.length === 0 && (
                <li className="px-2.5 py-6 text-center text-sm text-muted-foreground">
                  No countries found
                </li>
              )}
              {filtered.map((country, index) => {
                const isSelected = selectedSet.has(country.code);
                const isActive = index === activeIndex;
                const isDisabled = !isSelected && atLimit;
                return (
                  <li
                    key={country.code}
                    id={`${listboxId}-${country.code}`}
                    data-index={index}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={isDisabled || undefined}
                    onClick={() => !isDisabled && toggle(country.code)}
                    onPointerMove={() => setActiveIndex(index)}
                    className={cn(
                      'flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground',
                      isActive && 'bg-accent-soft',
                      isDisabled && 'cursor-not-allowed opacity-40',
                    )}
                  >
                    <span className="text-base leading-none" aria-hidden="true">
                      {codeToFlag(country.code)}
                    </span>
                    <span className="flex-1 truncate">{country.name}</span>
                    <span className="text-xs tabular-nums text-subtle-foreground">{country.code}</span>
                    <Check
                      className={cn(
                        'size-4 shrink-0 text-accent transition-opacity',
                        isSelected ? 'opacity-100' : 'opacity-0',
                      )}
                      aria-hidden="true"
                    />
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
