'use client';

/**
 * Avatar-frame cosmetics data layer (TanStack Query hooks).
 *
 *   useFrames()           → the public catalogue (free-first, ascending price)
 *   useMyFrames()         → the caller's inventory `{ equipped, owned }`
 *   usePurchaseFrame()    → buy a frame (atomic coin debit; auto-equips)
 *   useEquipFrame()       → equip a frame, or pass `null` to UNEQUIP
 *
 * Mirrors `use-covers.ts` end-to-end with one twist: a frame is OPTIONAL, so
 * the inventory's `equipped` is nullable and the equip mutation accepts
 * `FrameId | null` (passing `null` unequips the current frame and the avatar
 * renders bare).
 *
 * After any frame MUTATION the hooks keep the rest of the app coherent without
 * a reload: they refresh the wallet (a purchase spent coins), re-fetch the
 * inventory, and patch the owner's profile detail cache so the hero updates
 * instantly.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { FrameDesign, FrameId, PublicProfile, UserFrame } from '@ruletka/shared-types';

import { useAuth } from '@/features/auth';
import { useEconomyInvalidation } from '@/hooks/wallet/use-wallet';
import { profileKeys } from '@/features/profile/use-profile';
import { api } from '@/lib/api';

/**
 * Feature-local frames API surface — wraps the typed `api.request` escape
 * hatch with the actual NestJS routes. Kept inside the hook module to mirror
 * the covers feature layout (1:1 — catalogue/mine/purchase/equip).
 *
 * Routes (see `apps/api/src/modules/covers/covers.controller.ts`):
 *   GET  /frames/catalogue → FrameDesign[]   (public catalogue)
 *   GET  /frames/owned     → UserFrame       (auth)
 *   POST /frames/purchase  → UserFrame       (auth)
 *   POST /frames/equip     → PublicProfile   (auth; frameId may be `null`)
 */
export const framesApi = {
  /** Public frame catalogue (free first, then ascending price). */
  catalogue: () => api.request<FrameDesign[]>('/frames/catalogue'),
  /** The caller's inventory: `{ equipped, owned }`. */
  mine: () => api.request<UserFrame>('/frames/owned'),
  /** Buy a frame (atomic coin debit, auto-equips). Returns the new inventory. */
  purchase: (frameId: FrameId) =>
    api.request<UserFrame>('/frames/purchase', { method: 'POST', json: { frameId } }),
  /** Equip a frame (or pass `null` to unequip). Returns the updated profile. */
  equip: (frameId: FrameId | null) =>
    api.request<PublicProfile>('/frames/equip', { method: 'POST', json: { frameId } }),
} as const;

/** Centralised TanStack Query keys for the frames feature. */
export const frameKeys = {
  all: ['frames'] as const,
  catalogue: () => [...frameKeys.all, 'catalogue'] as const,
  mine: () => [...frameKeys.all, 'me'] as const,
} as const;

/**
 * The public frame catalogue. Long-lived: frames are code-defined, so the
 * list never changes within a session (cache it generously like the gift /
 * cover catalogues).
 */
export function useFrames(): UseQueryResult<FrameDesign[]> {
  return useQuery({
    queryKey: frameKeys.catalogue(),
    queryFn: framesApi.catalogue,
    staleTime: 30 * 60_000,
  });
}

/**
 * The caller's frame inventory `{ equipped, owned }`. Auth-gated so anonymous
 * surfaces never fire a guaranteed-401 request.
 */
export function useMyFrames(): UseQueryResult<UserFrame> {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: frameKeys.mine(),
    queryFn: framesApi.mine,
    enabled: isAuthenticated,
    staleTime: 60_000,
  });
}

/**
 * Shared post-mutation sync: refresh the wallet (a purchase spent coins),
 * cache the inventory, and patch the owner's profile detail cache so the hero
 * shows the new frame at once. `userId` is the caller (the only profile a
 * frame mutation can touch).
 *
 * Note we patch `equippedFrameId` onto the cached `PublicProfile` even though
 * the field is not part of the canonical `publicProfileSchema` yet — the
 * cache shape is loosely typed so this is forward-compatible: when the
 * contract grows the field, no code change is needed here.
 */
function useFrameSync() {
  const qc = useQueryClient();
  const { invalidateBalance } = useEconomyInvalidation();
  const { user } = useAuth();

  return (inventory: UserFrame) => {
    qc.setQueryData<UserFrame>(frameKeys.mine(), inventory);
    void qc.invalidateQueries({ queryKey: frameKeys.mine() });
    void invalidateBalance();
    if (user?.id) {
      qc.setQueryData<PublicProfile | undefined>(profileKeys.detail(user.id), (prev) =>
        prev
          ? ({ ...prev, equippedFrameId: inventory.equipped } as PublicProfile & {
              equippedFrameId: FrameId | null;
            })
          : prev,
      );
    }
  };
}

/**
 * Buy a frame. The atomic wallet debit is the server-side gate (422 on
 * insufficient funds), so the UI never pre-checks balance as authority — it
 * surfaces the error. On success the frame is owned AND equipped.
 */
export function usePurchaseFrame() {
  const sync = useFrameSync();
  return useMutation({
    mutationFn: (frameId: FrameId) => framesApi.purchase(frameId),
    onSuccess: (inventory) => sync(inventory),
  });
}

/**
 * Equip a frame, or pass `null` to UNEQUIP (the avatar renders bare). The
 * server returns the updated public profile so the hero updates instantly.
 */
export function useEquipFrame() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (frameId: FrameId | null) => framesApi.equip(frameId),
    onSuccess: (updated) => {
      // The response IS the canonical public profile.
      qc.setQueryData(profileKeys.detail(updated.id), updated);
      // Reflect the new equipped frame in the inventory cache without a
      // refetch. The PublicProfile may or may not yet carry the frame field
      // — we read it best-effort and fall back to `null`.
      const nextEquipped =
        (updated as PublicProfile & { equippedFrameId?: FrameId | null }).equippedFrameId ?? null;
      qc.setQueryData<UserFrame | undefined>(frameKeys.mine(), (prev) =>
        prev ? { ...prev, equipped: nextEquipped } : prev,
      );
      if (user?.id && user.id !== updated.id) {
        void qc.invalidateQueries({ queryKey: frameKeys.mine() });
      }
    },
  });
}
