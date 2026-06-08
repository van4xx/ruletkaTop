'use client';

/**
 * Ban-appeal mutation + the helper that reads the `banReason` carried by the
 * login 403.
 *
 * A banned account cannot authenticate, so the appeal goes to the PUBLIC,
 * credential-verified `POST /moderation/appeal` (email + password re-prove
 * identity) — no access token involved. The login rejection itself is a `403`
 * whose JSON body carries `banReason`, which {@link banReasonOf} extracts so the
 * UI can explain WHY the account is blocked and offer this appeal flow.
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type { Appeal, CreateAppealDto } from '@ruletka/shared-types';
import { api, ApiClientError } from '@/lib/api';

/**
 * Extract the ban reason from a failed-login error, if present. The API returns
 * a `403` with a structured body (`{ statusCode, message, error, banReason }`)
 * for a banned account; everything else yields `null`. `banReason` is an
 * additive field on the error body, so we read it defensively off `body`.
 */
export function banReasonOf(error: unknown): string | null {
  if (!(error instanceof ApiClientError) || error.status !== 403) return null;
  const body = error.body as { banReason?: unknown } | undefined;
  return typeof body?.banReason === 'string' && body.banReason.length > 0 ? body.banReason : null;
}

/** True when a failed login means "this account is banned" (a 403). */
export function isBannedError(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 403;
}

/**
 * Submit a ban appeal. Public + credential-verified; the server validates the
 * email/password and that the account is actually banned, then records a single
 * pending appeal a moderator reviews.
 */
export function useSubmitAppeal(): UseMutationResult<Appeal, ApiClientError, CreateAppealDto> {
  return useMutation<Appeal, ApiClientError, CreateAppealDto>({
    mutationFn: (dto) =>
      api.request<Appeal>('/moderation/appeal', {
        method: 'POST',
        json: dto,
        // No bearer (the user is banned), and no auto-retry (non-idempotent +
        // strictly throttled credential endpoint).
        skipAuth: true,
        noRetry: true,
      }),
  });
}
