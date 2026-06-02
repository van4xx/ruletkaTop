'use client';

/**
 * Thin dashboard-facing adapter over the app's unified modal system
 * (`@/components/modals` → `useModal()`), built by the modals feature.
 *
 * The dashboard opens three modals (top-up coins, buy a Top placement, edit
 * matchmaking filters). This wrapper maps the dashboard's intent to the modal
 * system's typed `open(type, props?)` and keeps a route `fallback` for safety —
 * if the `<ModalHost/>` provider isn't mounted yet, callers still navigate
 * somewhere sensible rather than no-op.
 *
 * INTEGRATOR NOTE: `<ModalHost/>` must be mounted once (in `providers.tsx`).
 * The modals feature's `index.ts` documents this; once mounted, every button
 * here opens the real modal. The route fallbacks (/coins, /top, /video|/voice)
 * remain valid destinations regardless.
 */
import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useModal, type ModalType } from '@/lib/stores/modal-store';

/**
 * Canonical modal names the dashboard opens, mapped to the modal system's
 * actual {@link ModalType} identifiers.
 */
export const MODAL = {
  buyCoins: 'buy-coins',
  buyTopPlacement: 'buy-top',
  filters: 'filters',
} as const satisfies Record<string, ModalType>;

export type DashboardModal = (typeof MODAL)[keyof typeof MODAL];

export interface OpenOptions {
  /** Route to navigate to if the modal host is unavailable (safety net). */
  fallback?: string;
}

export interface AppModals {
  /** Open one of the dashboard modals (no props needed — all are prop-less). */
  open: (name: DashboardModal, options?: OpenOptions) => void;
}

export function useAppModals(): AppModals {
  const { open: openModal } = useModal();
  const router = useRouter();

  const open = useCallback(
    (name: DashboardModal, options?: OpenOptions) => {
      try {
        // All three target modals accept empty/all-optional props, so a
        // no-arg open is type-correct and sufficient here.
        openModal(name);
      } catch {
        if (options?.fallback) router.push(options.fallback);
      }
    },
    [openModal, router],
  );

  return { open };
}
