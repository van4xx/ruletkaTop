'use client';

/**
 * KYC data layer — feature-local TanStack Query hooks for the
 * `/kyc/me` read and `/kyc/start` mutation.
 *
 * The settings tile polls `me` (rare-changing, low frequency) and the
 * "Начать проверку" button calls `start`. On success, the redirectUrl is
 * opened in a NEW TAB (the provider iframe lives off our origin), and the
 * `me` query is invalidated so a fresh refetch picks up the new `pending` /
 * `approved` state.
 *
 * When the gate is OFF on the API (`KYC_REQUIRED` falsy — the default), this
 * surface is informational only — the user can still verify voluntarily to
 * earn a future badge / unlock advanced moderation reviews.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { KycMeResponse, KycStartResponse } from '@ruletka/shared-types';

import { api, ApiClientError } from '@/lib/api';

export const KYC_ME_KEY = ['kyc', 'me'] as const;

/**
 * Current KYC state for the signed-in user. `staleTime` of 30s is plenty —
 * the only thing that changes this is the provider webhook firing, and the
 * user typically refreshes the page after returning from the provider tab.
 */
export function useKycStatus(): UseQueryResult<KycMeResponse, ApiClientError> {
  return useQuery<KycMeResponse, ApiClientError>({
    queryKey: KYC_ME_KEY,
    queryFn: () => api.kyc.me(),
    staleTime: 30_000,
  });
}

/**
 * Begin a verification session. On success, OPENS THE REDIRECTURL IN A NEW
 * TAB (popup-blocker-resistant: triggered from a direct user click) and
 * invalidates {@link KYC_ME_KEY} so the tile updates to the `pending` state
 * as soon as the user returns to the original tab.
 *
 * The provider session URL is off-origin (SumSub / Veriff iframe), so the
 * platform never holds document images / liveness blobs in our SPA bundle.
 */
export function useStartKyc(): UseMutationResult<KycStartResponse, ApiClientError, void> {
  const qc = useQueryClient();
  return useMutation<KycStartResponse, ApiClientError, void>({
    mutationFn: () => api.kyc.start(),
    onSuccess: (result) => {
      // Open the provider iframe in a new tab. `_blank` + `noopener` avoids
      // exposing window.opener to the (third-party) provider page.
      if (typeof window !== 'undefined' && result.redirectUrl) {
        window.open(result.redirectUrl, '_blank', 'noopener,noreferrer');
      }
      void qc.invalidateQueries({ queryKey: KYC_ME_KEY });
    },
  });
}
