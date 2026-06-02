'use client';

/**
 * `usePopover` — a tiny, dependency-free controller for a button-anchored
 * popover panel (used by the notifications bell).
 *
 * Provides: controlled open state, outside-pointer-down to close, `Escape` to
 * close (returning focus to the trigger), and the ref wiring. We deliberately
 * avoid pulling in `@radix-ui/react-popover` (not an existing dependency); the
 * avatar MENU still uses the design-system Radix `DropdownMenu`. This is for the
 * non-menu notifications panel where we want bespoke content + motion.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface PopoverController {
  open: boolean;
  setOpen: (next: boolean) => void;
  toggle: () => void;
  close: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
}

export function usePopover(): PopoverController {
  const [open, setOpenState] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setOpenState(false), []);
  const setOpen = useCallback((next: boolean) => setOpenState(next), []);
  const toggle = useCallback(() => setOpenState((v) => !v), []);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpenState(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpenState(false);
        triggerRef.current?.focus();
      }
    };

    // `pointerdown` (capture) closes before clicks land on inner links so a
    // click-through still navigates while dismissing the panel.
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return { open, setOpen, toggle, close, triggerRef, panelRef };
}
