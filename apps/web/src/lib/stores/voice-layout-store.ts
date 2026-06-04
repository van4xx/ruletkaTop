'use client';

/**
 * Voice-stage layout preference store.
 *
 * The /voice roulette ships two interchangeable visual layouts:
 *   - `equalizer` — the original mirrored-bars look (Layout A, the default).
 *   - `orb`       — the immersive "Aurora Orb" view (Layout B).
 *
 * This is a *pure presentation* preference — it never touches the WebRTC
 * session, streams, or matchmaking. It is persisted to localStorage so a
 * returning user lands straight back in their preferred vibe.
 *
 * Cloned from {@link useFiltersStore}: zustand + `persist` with a validating
 * `merge` so a stale/garbage blob can never break the stage (unknown value →
 * the safe default).
 *
 * SCOPE: this store owns the VOICE layout only. The /video layout is owned by a
 * separate store on purpose — do NOT add a `video` key here.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { AudioLines, Orbit, type LucideIcon } from 'lucide-react';

/** The id of a voice-stage layout. */
export type VoiceLayoutId = 'equalizer' | 'orb';

/** A switcher entry. `labelKey` resolves under the `roulette` i18n namespace. */
export interface VoiceLayoutMeta {
  id: VoiceLayoutId;
  icon: LucideIcon;
  /** Key under `voiceLayout.*` for the (aria) label, e.g. 'equalizer'. */
  labelKey: string;
}

/**
 * The typed registry of voice layouts. The switcher and the renderer both read
 * this, so adding a 3rd layout later is a single entry here (+ its component).
 * Order = display order in the switcher.
 */
export const VOICE_LAYOUTS: readonly VoiceLayoutMeta[] = [
  { id: 'equalizer', icon: AudioLines, labelKey: 'equalizer' },
  { id: 'orb', icon: Orbit, labelKey: 'orb' },
] as const;

/** The safe default everyone starts on (and the fallback for bad data). */
export const DEFAULT_VOICE_LAYOUT: VoiceLayoutId = 'equalizer';

const VALID_IDS = new Set<VoiceLayoutId>(VOICE_LAYOUTS.map((l) => l.id));

/** Narrow arbitrary persisted data to a known layout id, else the default. */
function coerceLayout(value: unknown): VoiceLayoutId {
  return typeof value === 'string' && VALID_IDS.has(value as VoiceLayoutId)
    ? (value as VoiceLayoutId)
    : DEFAULT_VOICE_LAYOUT;
}

interface VoiceLayoutState {
  voice: VoiceLayoutId;
  /** Set the active voice layout (ignores unknown ids). */
  setVoice: (next: VoiceLayoutId) => void;
}

export const useVoiceLayoutStore = create<VoiceLayoutState>()(
  persist(
    (set) => ({
      voice: DEFAULT_VOICE_LAYOUT,
      setVoice: (next) => set({ voice: coerceLayout(next) }),
    }),
    {
      name: 'ruletka.voice-layout',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Validate the persisted blob; fall back to the default if it's stale or
      // corrupt (mirrors filters-store.ts).
      merge: (persisted, current) => ({
        ...current,
        voice: coerceLayout((persisted as { voice?: unknown } | undefined)?.voice),
      }),
    },
  ),
);

/** Convenience selector: the active voice layout id. */
export function useVoiceLayout(): VoiceLayoutId {
  return useVoiceLayoutStore((s) => s.voice);
}

/** Imperatively set the voice layout (e.g. from the switcher). */
export function setVoiceLayout(next: VoiceLayoutId): void {
  useVoiceLayoutStore.getState().setVoice(next);
}
