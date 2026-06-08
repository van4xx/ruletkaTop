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
 * True when a failed login means "this ACCOUNT is banned" (an appealable ban),
 * as opposed to the device/network ban-evasion gate which is ALSO a 403 but is
 * NOT appealable here. The API discriminates the two: an account ban carries
 * `banned: true` in its 403 body; the device/network gate carries
 * `deviceBlocked: true` and no `banned`. We require the `banned` flag so the
 * device gate never routes the user into a dead-end appeal flow.
 */
export function isBannedError(error: unknown): boolean {
  if (!(error instanceof ApiClientError) || error.status !== 403) return false;
  const body = error.body as { banned?: unknown } | undefined;
  return body?.banned === true;
}

/**
 * Extract the ban reason from a failed-login error, if present. Only an ACCOUNT
 * ban (a `403` with `{ banned: true, banReason }`) carries a reason; the
 * device/network gate and everything else yield `null`. `banReason` is an
 * additive field on the error body, so we read it defensively off `body`.
 */
export function banReasonOf(error: unknown): string | null {
  if (!isBannedError(error)) return null;
  const body = (error as ApiClientError).body as { banReason?: unknown } | undefined;
  return typeof body?.banReason === 'string' && body.banReason.length > 0 ? body.banReason : null;
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
