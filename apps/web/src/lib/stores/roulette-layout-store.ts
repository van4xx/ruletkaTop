'use client';

/**
 * Video-roulette layout store.
 *
 * Persists the user's chosen STAGE LAYOUT for /video so a refresh keeps it:
 *   - `'standard'` — the classic full-bleed remote feed + draggable local PiP.
 *   - `'grid'`     — a 2×2 grid (peer / me / square controls / per-call chat).
 *
 * Only the standard-vs-grid choice is persisted. Fullscreen is intentionally
 * NOT stored here: the browser Fullscreen API requires a user gesture, so we
 * can't re-enter it on load — it lives as ephemeral `useState` in the stage.
 *
 * Mirrors {@link useFiltersStore}: zustand + `persist` + `createJSONStorage`
 * with a validating `merge` so a stale/corrupt blob falls back to `'standard'`.
 * We expose a `useLayoutHydrated()` flag (via `persist.onFinishHydration`) so
 * the stage can render `'standard'` on the server and until rehydration, then
 * switch — avoiding an SSR/CSR layout flash (same trade-off as filters).
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/** The two persisted stage layouts for the video roulette. */
export type RouletteLayoutMode = 'standard' | 'grid';

const LAYOUT_MODES: readonly RouletteLayoutMode[] = ['standard', 'grid'];

function isLayoutMode(value: unknown): value is RouletteLayoutMode {
  return typeof value === 'string' && (LAYOUT_MODES as readonly string[]).includes(value);
}

interface LayoutState {
  /** The persisted stage layout (standard | grid). */
  mode: RouletteLayoutMode;
  /** Switch the stage layout. */
  setMode: (mode: RouletteLayoutMode) => void;
}

export const useRouletteLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      mode: 'standard',
      setMode: (mode) => {
        if (isLayoutMode(mode)) set({ mode });
      },
    }),
    {
      name: 'ruletka.video-layout',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Validate the persisted blob; fall back to 'standard' if stale/corrupt.
      merge: (persisted, current) => {
        const raw = (persisted as { mode?: unknown } | undefined)?.mode;
        return { ...current, mode: isLayoutMode(raw) ? raw : 'standard' };
      },
    },
  ),
);

/** Convenience selector: just the current layout mode. */
export function useLayoutMode(): RouletteLayoutMode {
  return useRouletteLayoutStore((s) => s.mode);
}

/**
 * True once the persisted layout has rehydrated from localStorage. Lets the
 * stage avoid an SSR/CSR mismatch: render `'standard'` until this flips true.
 */
export function useLayoutHydrated(): boolean {
  // Start `false` on BOTH the server and the client's first render. The persist
  // API isn't available during SSR (no localStorage), so calling `hasHydrated()`
  // in the `useState` initializer throws "Cannot read properties of undefined
  // (reading 'hasHydrated')" and aborts server rendering of the whole stage. The
  // stage renders `'standard'` until this flips true on the client — which is the
  // intended SSR/CSR-mismatch-free behaviour anyway.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const persist = useRouletteLayoutStore.persist;
    if (!persist) {
      setHydrated(true);
      return;
    }
    // Already hydrated (e.g. a fast client nav) — nothing to wait for.
    if (persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const unsub = persist.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, []);

  return hydrated;
}
