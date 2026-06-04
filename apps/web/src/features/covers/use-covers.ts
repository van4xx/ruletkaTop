'use client';

/**
 * Cover-cosmetics data layer (TanStack Query hooks over {@link coversApi}).
 *
 *   useCovers()          → the public catalogue (free-first, ascending price)
 *   useMyCovers()        → the caller's inventory `{ active, owned }`
 *   usePurchaseCover()   → buy a cover (atomic coin debit; auto-activates)
 *   useSetActiveCover()  → switch the active cover to an owned/free id
 *
 * After any cover MUTATION the hooks keep the rest of the app coherent without a
 * reload: they refresh the wallet balance + ledger (a purchase spent coins),
 * re-fetch the inventory, and write the new `activeCover` into the owner's
 * profile detail cache (`['profile','detail',id]`) so the hero updates instantly.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { CoverId, CoverInventory, ProfileCover, PublicProfile } from '@ruletka/shared-types';

import { useAuth } from '@/features/auth';
import { useEconomyInvalidation } from '@/hooks/wallet/use-wallet';
import { profileKeys } from '@/features/profile/use-profile';
import { coversApi, coverKeys } from './covers-api';

/**
 * The public cover catalogue. Long-lived: covers are code-defined, so the list
 * never changes within a session (cache it generously like the gift catalogue).
 */
export function useCovers(): UseQueryResult<ProfileCover[]> {
  return useQuery({
    queryKey: coverKeys.catalogue(),
    queryFn: coversApi.catalogue,
    staleTime: 30 * 60_000,
  });
}

/**
 * The caller's cover inventory `{ active, owned }`. Auth-gated (the endpoint is
 * authenticated), so anonymous surfaces never fire a guaranteed-401 request.
 */
export function useMyCovers(): UseQueryResult<CoverInventory> {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: coverKeys.mine(),
    queryFn: coversApi.mine,
    enabled: isAuthenticated,
    staleTime: 60_000,
  });
}

/**
 * Shared post-mutation sync: refresh wallet (a purchase spent coins) + inventory,
 * and patch the owner's profile detail cache so the hero shows the new cover at
 * once. `userId` is the caller (the only profile a cover mutation can touch).
 */
function useCoverSync() {
  const qc = useQueryClient();
  const { invalidateBalance } = useEconomyInvalidation();
  const { user } = useAuth();

  return (inventory: CoverInventory) => {
    qc.setQueryData<CoverInventory>(coverKeys.mine(), inventory);
    void qc.invalidateQueries({ queryKey: coverKeys.mine() });
    void invalidateBalance();
    if (user?.id) {
      qc.setQueryData<PublicProfile | undefined>(profileKeys.detail(user.id), (prev) =>
        prev ? { ...prev, activeCover: inventory.active } : prev,
      );
    }
  };
}

/**
 * Buy a cover. The atomic wallet debit is the server-side gate (422 on
 * insufficient funds), so the UI never pre-checks balance as authority — it just
 * surfaces the error. On success the cover is owned AND activated.
 */
export function usePurchaseCover() {
  const sync = useCoverSync();
  return useMutation({
    mutationFn: (coverId: CoverId) => coversApi.purchase(coverId),
    onSuccess: (inventory) => sync(inventory),
  });
}

/** Switch the active cover to an owned/free id (returns the updated profile). */
export function useSetActiveCover() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (coverId: CoverId) => coversApi.setActive(coverId),
    onSuccess: (updated) => {
      // The response IS the canonical public profile — cache it like GET /profiles/:id.
      qc.setQueryData(profileKeys.detail(updated.id), updated);
      // Reflect the new active cover in the inventory cache without a refetch.
      qc.setQueryData<CoverInventory | undefined>(coverKeys.mine(), (prev) =>
        prev ? { ...prev, active: updated.activeCover } : prev,
      );
      if (user?.id && user.id !== updated.id) {
        void qc.invalidateQueries({ queryKey: coverKeys.mine() });
      }
    },
  });
}
