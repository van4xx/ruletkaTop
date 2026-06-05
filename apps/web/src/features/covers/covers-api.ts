/**
 * Feature-local cover-cosmetics API surface + query keys.
 *
 * Kept SEPARATE from the core `@/lib/api` client (and from the economy feature
 * api) so the covers feature stays self-contained: it only wraps the shared,
 * typed `api.request` escape hatch with the actual `/covers` NestJS routes.
 *
 * Routes (see `apps/api/src/modules/covers/covers.controller.ts`):
 *   GET  /covers          → ProfileCover[]   (public catalogue, free-first)
 *   GET  /covers/me        → CoverInventory   (auth; { active, owned })
 *   POST /covers/purchase  → CoverInventory   (auth; debits coins, auto-activates)
 *   POST /covers/active    → PublicProfile    (auth; switch active cover)
 *
 * Every type is sourced from the `@ruletka/shared-types` contract.
 */
import { api } from '@/lib/api';
import type { CoverId, CoverInventory, ProfileCover, PublicProfile } from '@ruletka/shared-types';

export const coversApi = {
  /** Public cover catalogue (free first, then ascending price). */
  catalogue: () => api.request<ProfileCover[]>('/covers'),
  /** The caller's inventory: `{ active, owned }` (free ids ∪ purchased ids). */
  mine: () => api.request<CoverInventory>('/covers/me'),
  /** Buy a cover (atomic coin debit, auto-activates). Returns the new inventory. */
  purchase: (coverId: CoverId) =>
    api.request<CoverInventory>('/covers/purchase', { method: 'POST', json: { coverId } }),
  /** Switch the active cover to an owned/free id. Returns the updated profile. */
  setActive: (coverId: CoverId) =>
    api.request<PublicProfile>('/covers/active', { method: 'POST', json: { coverId } }),
} as const;

/** Centralised TanStack Query keys for the covers feature. */
export const coverKeys = {
  all: ['covers'] as const,
  catalogue: () => [...coverKeys.all, 'catalogue'] as const,
  mine: () => [...coverKeys.all, 'me'] as const,
} as const;
